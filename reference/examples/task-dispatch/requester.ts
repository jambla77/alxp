/**
 * Task Dispatcher — collects context, dispatches coding tasks via ALXP, merges results.
 *
 * Discovers workers via registry, sends ANNOUNCE_TASK, handles BID/AWARD/RESULT lifecycle,
 * then merges completed results into git branches.
 */

import { ulid } from "ulid";
import {
  generateAgentIdentity,
  signString,
  ALXPServer,
  ALXPClient,
} from "../../src/index.js";
import type { AgentIdentity, AgentDescription } from "../../src/index.js";
import type { AnnounceTask, Award, DID } from "../../src/types/index.js";
import { collectContext } from "./context-collector.js";
import { mergeResult } from "./result-merger.js";
import type { TaskDefinition, DispatchResult, TaskFile } from "./types.js";
import type { DispatchConfig } from "./config.js";

interface PendingTask {
  taskId: string;
  contractId: string;
  definition: TaskDefinition;
  files: TaskFile[];
  workerEndpoint: string;
  workerDid: DID;
  startTime: number;
  resolve: (result: DispatchResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerInfo {
  did: DID;
  endpoint: string;
}

export class TaskDispatcher {
  private identity!: AgentIdentity;
  private server!: ALXPServer;
  private client!: ALXPClient;
  private workers: WorkerInfo[] = [];
  private pendingByTask = new Map<string, PendingTask>();

  constructor(private config: DispatchConfig) {}

  async start(): Promise<void> {
    const { requesterPort, localIp } = this.config;
    const endpoint = `http://${localIp}:${requesterPort}`;

    this.identity = generateAgentIdentity(endpoint);
    this.server = new ALXPServer();
    this.client = new ALXPClient(this.identity.did, this.identity.keyPair.privateKey);

    // Handle BID — auto-accept first bid
    this.server.router.on("BID", async (msg) => {
      const offer = (msg.payload as { type: "BID"; offer: any }).offer;
      const pending = this.pendingByTask.get(offer.taskId);
      if (!pending) return;

      // In task-board mode, the worker endpoint comes from the bid's reply-endpoint header
      const workerEndpoint = pending.workerEndpoint || msg.headers?.["reply-endpoint"] || "";
      const workerDid = pending.workerDid || msg.sender;

      const contractId = pending.contractId;
      const contract = {
        id: contractId,
        taskId: pending.taskId,
        offerId: offer.id,
        requester: this.identity.did,
        worker: offer.worker,
        agreedPrice: offer.price,
        agreedDeadline: new Date(Date.now() + 600000).toISOString(),
        agreedVerification: { method: "schema-check" },
        delegationGrant: {
          issuer: this.identity.did,
          audience: offer.worker,
          capabilities: ["context/read"],
          expiration: new Date(Date.now() + 600000).toISOString(),
          token: signString(`${contractId}:grant`, this.identity.keyPair.privateKey),
        },
        cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
        requesterSignature: signString(contractId, this.identity.keyPair.privateKey),
        workerSignature: signString(contractId, this.identity.keyPair.privateKey),
        formed: new Date().toISOString(),
      };

      // Encode task data in headers for the worker
      const filesObj: Record<string, string> = {};
      for (const f of pending.files) {
        filesObj[f.path] = f.content;
      }

      await this.client.send(
        workerEndpoint,
        { type: "AWARD", contract } satisfies Award,
        {
          recipient: workerDid,
          headers: {
            "reply-endpoint": `http://${this.config.localIp}:${this.config.requesterPort}`,
            "task-objective": pending.definition.objective,
            "task-files": JSON.stringify(filesObj),
            "task-tags": JSON.stringify(pending.definition.tags ?? []),
          },
        },
      );
    });

    // Handle SUBMIT_RESULT — merge into git branch
    this.server.router.on("SUBMIT_RESULT", async (msg) => {
      const result = (msg.payload as { type: "SUBMIT_RESULT"; result: any }).result;

      // Find pending task by contractId
      let pending: PendingTask | undefined;
      for (const p of this.pendingByTask.values()) {
        if (p.contractId === result.contractId) {
          pending = p;
          break;
        }
      }
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingByTask.delete(pending.taskId);

      const elapsed = Date.now() - pending.startTime;

      // Extract files from result outputs
      const outputFiles = new Map<string, string>();
      for (const output of result.outputs) {
        outputFiles.set(output.name, output.data);
      }

      try {
        const merge = await mergeResult(
          this.config.projectRoot,
          pending.taskId,
          pending.definition.objective,
          outputFiles,
          msg.sender,
        );

        pending.resolve({
          taskId: pending.taskId,
          objective: pending.definition.objective,
          status: "completed",
          merge,
          workerDid: msg.sender,
          durationMs: elapsed,
        });
      } catch (err) {
        pending.resolve({
          taskId: pending.taskId,
          objective: pending.definition.objective,
          status: "failed",
          error: `Merge failed: ${err instanceof Error ? err.message : err}`,
          workerDid: msg.sender,
          durationMs: elapsed,
        });
      }
    });

    await this.server.listen(requesterPort);
  }

  /** Discover coding workers from the registry */
  async discoverWorkers(): Promise<number> {
    const res = await fetch(`${this.config.registryUrl}/agents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "coding" }),
    });

    if (!res.ok) throw new Error(`Registry query failed: ${res.status}`);

    const data = (await res.json()) as { agents: AgentDescription[]; count: number };
    this.workers = data.agents.map((a) => ({
      did: a.id as DID,
      endpoint: a.endpoints[0].url,
    }));

    return this.workers.length;
  }

  /** Dispatch a list of task definitions in parallel */
  async dispatch(tasks: TaskDefinition[]): Promise<DispatchResult[]> {
    if (this.workers.length === 0) {
      throw new Error("No workers discovered — call discoverWorkers() first");
    }

    console.log(`\nDispatching ${tasks.length} task(s) to ${this.workers.length} worker(s)...\n`);

    const promises: Promise<DispatchResult>[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const worker = this.workers[i % this.workers.length];
      promises.push(this.dispatchOne(task, worker));
    }

    const results = await Promise.all(promises);
    return results;
  }

  private async dispatchOne(
    task: TaskDefinition,
    worker: WorkerInfo,
  ): Promise<DispatchResult> {
    // Collect context files
    console.log(`  Collecting context for: "${task.objective}"...`);
    const files = await collectContext(this.config.projectRoot, task);
    console.log(`  Collected ${files.length} file(s) (${files.reduce((s, f) => s + f.content.length, 0)} bytes)`);

    const taskId = ulid();
    const contractId = ulid();
    const startTime = Date.now();

    return new Promise<DispatchResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingByTask.delete(taskId);
        resolve({
          taskId,
          objective: task.objective,
          status: "timeout",
          error: `Task timed out after ${this.config.taskTimeoutMs}ms`,
          durationMs: Date.now() - startTime,
        });
      }, this.config.taskTimeoutMs);

      this.pendingByTask.set(taskId, {
        taskId,
        contractId,
        definition: task,
        files,
        workerEndpoint: worker.endpoint,
        workerDid: worker.did,
        startTime,
        resolve,
        timer,
      });

      // Send ANNOUNCE_TASK
      const taskSpec = {
        id: taskId,
        requester: this.identity.did,
        created: new Date().toISOString(),
        objective: task.objective,
        domain: "coding",
        inputs: files.map((f) => ({
          name: f.path,
          mimeType: "text/plain",
          data: f.content,
        })),
        expectedOutput: {
          mimeType: "text/plain",
          description: "Modified source files",
        },
        privacyClass: "public" as const,
        delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: false },
        acceptanceCriteria: [{ type: "schema" as const, schema: { type: "object" } }],
        verificationMethod: "optimistic" as const,
        tags: task.tags ?? [],
        signature: signString(taskId, this.identity.keyPair.privateKey),
      };

      this.client.send(
        worker.endpoint,
        { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
        {
          recipient: worker.did,
          headers: {
            "reply-endpoint": `http://${this.config.localIp}:${this.config.requesterPort}`,
          },
        },
      ).catch((err) => {
        clearTimeout(timer);
        this.pendingByTask.delete(taskId);
        resolve({
          taskId,
          objective: task.objective,
          status: "failed",
          error: `Send error: ${err instanceof Error ? err.message : err}`,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /** Post tasks to the registry's task board (pull-based mode). */
  async postToBoard(tasks: TaskDefinition[]): Promise<void> {
    const replyEndpoint = `http://${this.config.localIp}:${this.config.requesterPort}`;

    for (const task of tasks) {
      const files = await collectContext(this.config.projectRoot, task);
      const taskId = ulid();
      const contractId = ulid();
      const startTime = Date.now();

      const taskSpec = {
        id: taskId,
        requester: this.identity.did,
        created: new Date().toISOString(),
        objective: task.objective,
        domain: "coding",
        inputs: files.map((f) => ({
          name: f.path,
          mimeType: "text/plain",
          data: f.content,
        })),
        expectedOutput: {
          mimeType: "text/plain",
          description: "Modified source files",
        },
        privacyClass: "public" as const,
        delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: false },
        acceptanceCriteria: [{ type: "schema" as const, schema: { type: "object" } }],
        verificationMethod: "optimistic" as const,
        tags: task.tags ?? [],
        signature: signString(taskId, this.identity.keyPair.privateKey),
      };

      // Register as pending so we can handle BID → AWARD → RESULT
      const pending: PendingTask = {
        taskId,
        contractId,
        definition: task,
        files,
        workerEndpoint: "", // filled when bid arrives
        workerDid: "" as DID, // filled when bid arrives
        startTime,
        resolve: () => {},
        timer: setTimeout(() => {}, this.config.taskTimeoutMs),
      };
      this.pendingByTask.set(taskId, pending);

      const res = await fetch(`${this.config.registryUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskSpec, replyEndpoint }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to post task to board: ${res.status} ${body}`);
      }

      console.log(`  Posted to board: "${task.objective}" (${taskId.substring(0, 8)})`);
    }
  }

  /** Wait for all pending tasks to complete or timeout. */
  async waitForResults(): Promise<DispatchResult[]> {
    const promises: Promise<DispatchResult>[] = [];

    for (const pending of this.pendingByTask.values()) {
      // Replace the dummy resolve/timer with a real promise
      const p = new Promise<DispatchResult>((resolve) => {
        clearTimeout(pending.timer);
        pending.resolve = resolve;
        pending.timer = setTimeout(() => {
          this.pendingByTask.delete(pending.taskId);
          resolve({
            taskId: pending.taskId,
            objective: pending.definition.objective,
            status: "timeout",
            error: `Task timed out after ${this.config.taskTimeoutMs}ms`,
            durationMs: Date.now() - pending.startTime,
          });
        }, this.config.taskTimeoutMs);
      });
      promises.push(p);
    }

    return Promise.all(promises);
  }

  async stop(): Promise<void> {
    // Clean up any remaining timeouts
    for (const pending of this.pendingByTask.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingByTask.clear();
    await this.server.close();
  }
}
