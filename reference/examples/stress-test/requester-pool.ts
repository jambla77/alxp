/**
 * Requester Pool — launches N requesters that discover workers via the
 * registry and dispatch tasks round-robin with bounded concurrency.
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
import { generateTask, type TaskType } from "./task-generators.js";
import { verifyResult } from "./task-solvers.js";
import { MetricsCollector } from "./metrics.js";
import type { StressConfig } from "./config.js";

interface PendingTask {
  taskId: string;
  contractId: string;
  taskType: TaskType;
  input: unknown;
  workerEndpoint: string;
  workerDid: DID;
  resolve: (value: void) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerInfo {
  did: DID;
  endpoint: string;
}

interface RequesterAgent {
  identity: AgentIdentity;
  server: ALXPServer;
  client: ALXPClient;
  port: number;
  endpoint: string;
}

export class RequesterPool {
  private requesters: RequesterAgent[] = [];
  private workers: WorkerInfo[] = [];
  readonly metrics = new MetricsCollector();

  constructor(private config: StressConfig) {}

  async start(): Promise<void> {
    const { requesterCount, requesterPortStart } = this.config;
    console.log(`Starting ${requesterCount} requesters on ports ${requesterPortStart}-${requesterPortStart + requesterCount - 1}...`);

    const startups: Promise<void>[] = [];
    for (let i = 0; i < requesterCount; i++) {
      startups.push(this.startRequester(i));
    }
    await Promise.all(startups);
    console.log(`All ${requesterCount} requesters ready.`);
  }

  /** Discover workers from the registry */
  async discoverWorkers(): Promise<number> {
    const res = await fetch(`${this.config.registryUrl}/agents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "computation" }),
    });

    if (!res.ok) throw new Error(`Registry query failed: ${res.status}`);

    const data = (await res.json()) as { agents: AgentDescription[]; count: number };
    this.workers = data.agents.map((a) => ({
      did: a.id,
      endpoint: a.endpoints[0].url,
    }));

    console.log(`Discovered ${this.workers.length} workers.`);
    return this.workers.length;
  }

  /** Run all requesters dispatching tasks */
  async run(): Promise<void> {
    if (this.workers.length === 0) {
      throw new Error("No workers discovered — call discoverWorkers() first");
    }

    this.metrics.start();
    const runs: Promise<void>[] = [];
    for (let i = 0; i < this.requesters.length; i++) {
      runs.push(this.runRequester(i));
    }
    await Promise.all(runs);
    this.metrics.report();
  }

  private async startRequester(index: number): Promise<void> {
    const port = this.config.requesterPortStart + index;
    const endpoint = `http://${this.config.localIp}:${port}`;
    const identity = generateAgentIdentity(endpoint);
    const server = new ALXPServer();
    const client = new ALXPClient(identity.did, identity.keyPair.privateKey);

    const requester: RequesterAgent = { identity, server, client, port, endpoint };
    this.requesters.push(requester);

    await server.listen(port);
  }

  private async runRequester(index: number): Promise<void> {
    const requester = this.requesters[index];
    const { tasksPerRequester, concurrencyPerRequester } = this.config;

    // Track pending tasks for this requester by taskId
    const pendingByTask = new Map<string, PendingTask>();

    // Set up message handlers
    requester.server.router.on("BID", async (msg) => {
      const offer = (msg.payload as { type: "BID"; offer: any }).offer;
      const pending = pendingByTask.get(offer.taskId);
      if (!pending) return; // Task already resolved or unknown

      // Accept the bid — form contract and send AWARD
      const contractId = pending.contractId;
      const contract = {
        id: contractId,
        taskId: pending.taskId,
        offerId: offer.id,
        requester: requester.identity.did,
        worker: offer.worker,
        agreedPrice: offer.price,
        agreedDeadline: new Date(Date.now() + 60000).toISOString(),
        agreedVerification: { method: "schema-check" },
        delegationGrant: {
          issuer: requester.identity.did,
          audience: offer.worker,
          capabilities: ["context/read"],
          expiration: new Date(Date.now() + 60000).toISOString(),
          token: signString(`${contractId}:grant`, requester.identity.keyPair.privateKey),
        },
        cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
        requesterSignature: signString(contractId, requester.identity.keyPair.privateKey),
        workerSignature: signString(contractId, requester.identity.keyPair.privateKey),
        formed: new Date().toISOString(),
      };

      await requester.client.send(
        pending.workerEndpoint,
        { type: "AWARD", contract } satisfies Award,
        {
          recipient: pending.workerDid,
          headers: {
            "reply-endpoint": requester.endpoint,
            "task-input": JSON.stringify(pending.input),
          },
        },
      );
    });

    requester.server.router.on("SUBMIT_RESULT", async (msg) => {
      const result = (msg.payload as { type: "SUBMIT_RESULT"; result: any }).result;
      // Find pending task by contractId
      let pending: PendingTask | undefined;
      for (const p of pendingByTask.values()) {
        if (p.contractId === result.contractId) {
          pending = p;
          break;
        }
      }
      if (!pending) return;

      clearTimeout(pending.timer);
      pendingByTask.delete(pending.taskId);

      // Verify the result
      const output = JSON.parse(result.outputs[0].data);
      const correct = verifyResult(pending.input, output);

      if (correct) {
        this.metrics.complete(pending.taskId, "completed");
      } else {
        this.metrics.complete(pending.taskId, "failed", "incorrect result");
      }
      pending.resolve();
    });

    // Dispatch tasks with bounded concurrency using a semaphore
    let workerIdx = index; // Start round-robin offset by requester index
    let inflight = 0;
    let tasksSent = 0;

    const dispatch = (): Promise<void> => {
      return new Promise(async (resolveAll) => {
        const tryNext = async () => {
          while (tasksSent < tasksPerRequester && inflight < concurrencyPerRequester) {
            const task = generateTask();
            const taskId = ulid();
            const contractId = ulid();
            const worker = this.workers[workerIdx % this.workers.length];
            workerIdx++;

            const taskPromise = new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                pendingByTask.delete(taskId);
                this.metrics.complete(taskId, "timeout");
                inflight--;
                resolve();
                tryNext();
              }, this.config.taskTimeoutMs);

              pendingByTask.set(taskId, {
                taskId,
                contractId,
                taskType: task.type,
                input: task.input,
                workerEndpoint: worker.endpoint,
                workerDid: worker.did,
                resolve: () => {
                  inflight--;
                  resolve();
                  tryNext();
                },
                reject: (err: Error) => {
                  inflight--;
                  reject(err);
                  tryNext();
                },
                timer,
              });
            });

            this.metrics.record(taskId, {
              taskType: task.type,
              workerId: worker.did,
              requesterId: requester.identity.did,
              startTime: Date.now(),
              status: "pending",
            });

            inflight++;
            tasksSent++;

            // Send ANNOUNCE_TASK
            const taskSpec = {
              id: taskId,
              requester: requester.identity.did,
              created: new Date().toISOString(),
              objective: task.objective,
              domain: task.domain,
              inputs: [{
                name: "input",
                mimeType: "application/json",
                data: JSON.stringify(task.input),
              }],
              expectedOutput: {
                mimeType: "application/json",
                description: "Computed result",
              },
              privacyClass: "public" as const,
              delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: false },
              acceptanceCriteria: [{ type: "schema" as const, schema: { type: "object" } }],
              verificationMethod: "optimistic" as const,
              tags: [task.type],
              signature: signString(taskId, requester.identity.keyPair.privateKey),
            };

            requester.client.send(
              worker.endpoint,
              { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
              {
                recipient: worker.did,
                headers: { "reply-endpoint": requester.endpoint },
              },
            ).catch((err) => {
              const pending = pendingByTask.get(taskId);
              if (pending) {
                clearTimeout(pending.timer);
                pendingByTask.delete(taskId);
                this.metrics.complete(taskId, "failed", `send error: ${err.message}`);
                inflight--;
              }
            });
          }

          // Check if all done
          if (tasksSent >= tasksPerRequester && inflight === 0) {
            resolveAll();
          }
        };

        tryNext();
      });
    };

    await dispatch();
  }

  async stop(): Promise<void> {
    await Promise.all(this.requesters.map((r) => r.server.close()));
  }
}
