/**
 * Coding Worker — receives coding tasks via ALXP, invokes a solver, returns file outputs.
 *
 * Registers with the registry as a "coding" domain worker.
 * Handles ANNOUNCE_TASK (auto-bid) and AWARD (solve + submit result).
 */

import { ulid } from "ulid";
import {
  generateAgentIdentity,
  signString,
  ALXPServer,
  ALXPClient,
  generateAgentCard,
} from "../../src/index.js";
import type { AgentIdentity } from "../../src/index.js";
import type { Bid, SubmitResult } from "../../src/types/index.js";
import type { TaskSolver } from "./solvers/interface.js";
import type { CodingTask } from "./types.js";

export interface CodingWorkerConfig {
  port: number;
  hostname: string;
  endpoint: string;
  registryUrl: string;
  solver: TaskSolver;
  subscriptionTier?: string;
  capacitySharePercent?: number;
}

export class CodingWorker {
  private identity!: AgentIdentity;
  private server!: ALXPServer;
  private client!: ALXPClient;
  private tasksHandled = 0;

  constructor(private config: CodingWorkerConfig) {}

  async start(): Promise<void> {
    const { port, hostname, endpoint } = this.config;

    this.identity = generateAgentIdentity(endpoint);
    this.server = new ALXPServer();
    this.client = new ALXPClient(this.identity.did, this.identity.keyPair.privateKey);

    // Handle ANNOUNCE_TASK — auto-bid
    this.server.router.on("ANNOUNCE_TASK", async (msg) => {
      const taskSpec = (msg.payload as { type: "ANNOUNCE_TASK"; taskSpec: any }).taskSpec;
      const replyEndpoint = msg.headers?.["reply-endpoint"];
      if (!replyEndpoint) {
        console.error("Worker: no reply-endpoint header on ANNOUNCE_TASK");
        return;
      }

      console.log(`  Received task: "${taskSpec.objective}" (${taskSpec.id.substring(0, 8)})`);

      const offerId = ulid();
      const offer = {
        id: offerId,
        taskId: taskSpec.id,
        worker: this.identity.did,
        created: new Date().toISOString(),
        expires: new Date(Date.now() + 3600000).toISOString(),
        price: { amount: 0, currency: "USD", model: "fixed" as const },
        estimatedDuration: "PT5M",
        confidence: 0.9,
        requiredContext: [],
        relevantReputation: [],
        relevantCredentials: [],
        signature: signString(offerId, this.identity.keyPair.privateKey),
      };

      await this.client.send(
        replyEndpoint,
        { type: "BID", offer } satisfies Bid,
        { recipient: msg.sender },
      );
    });

    // Handle AWARD — invoke solver and submit result
    this.server.router.on("AWARD", async (msg) => {
      const contract = (msg.payload as { type: "AWARD"; contract: any }).contract;
      const replyEndpoint = msg.headers?.["reply-endpoint"];
      if (!replyEndpoint) {
        console.error("Worker: no reply-endpoint header on AWARD");
        return;
      }

      // Extract task data from headers
      const objectiveHeader = msg.headers?.["task-objective"];
      const filesJson = msg.headers?.["task-files"];
      const tagsJson = msg.headers?.["task-tags"];

      if (!objectiveHeader || !filesJson) {
        console.error("Worker: missing task-objective or task-files headers");
        return;
      }

      const filesObj = JSON.parse(filesJson) as Record<string, string>;
      const codingTask: CodingTask = {
        objective: objectiveHeader,
        files: new Map(Object.entries(filesObj)),
        tags: tagsJson ? JSON.parse(tagsJson) : [],
      };

      console.log(`  Solving: "${objectiveHeader}" with ${this.config.solver.name}...`);
      const startTime = Date.now();

      try {
        const result = await this.config.solver.solve(codingTask);
        const elapsed = Date.now() - startTime;
        console.log(`  Solved in ${elapsed}ms: ${result.summary}`);

        // Package result as TaskOutput[] — each file is an output
        const outputs = [...result.files.entries()].map(([path, content]) => ({
          name: path,
          mimeType: "text/plain",
          data: content,
          encoding: "utf-8" as const,
        }));

        const resultId = ulid();
        const resultBundle = {
          id: resultId,
          contractId: contract.id,
          worker: this.identity.did,
          submitted: new Date().toISOString(),
          outputs,
          provenance: {
            agentId: this.identity.did,
            modelId: this.config.solver.name,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
          },
          selfAssessment: { confidence: 0.8 },
          signature: signString(resultId, this.identity.keyPair.privateKey),
        };

        await this.client.send(
          replyEndpoint,
          { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
          {
            recipient: msg.sender,
            headers: { "result-summary": result.summary },
          },
        );
        this.tasksHandled++;
      } catch (err) {
        console.error(`  Solver error: ${err instanceof Error ? err.message : err}`);
      }
    });

    await this.server.listen(port, hostname);
    const tierLabel = this.config.subscriptionTier ?? "local";
    const shareLabel = this.config.capacitySharePercent ?? 50;
    console.log(`Worker listening on ${endpoint}`);
    console.log(`  Sharing capacity from your ${this.config.solver.name} subscription (${tierLabel} tier, ${shareLabel}% shared)`);

    // Register with registry
    await this.register();
  }

  private async register(): Promise<void> {
    // Determine capacity source from solver config
    const provider = this.config.solver.name === "claude-solver"
      ? "anthropic" as const
      : this.config.solver.name === "openai-solver"
        ? "openai" as const
        : "local" as const;

    const tier = (this.config.subscriptionTier ?? "local-gpu") as any;
    const sharePercent = (this.config.capacitySharePercent ?? 50) / 100;

    const card = generateAgentCard({
      identity: this.identity,
      name: "coding-worker",
      description: `Coding worker sharing ${this.config.solver.name} capacity`,
      capabilities: [{
        domain: "coding",
        subDomain: "general",
        tags: ["typescript", "javascript", "python", "code-modification"],
        confidenceLevel: 0.9,
      }],
      trustTier: "same-owner",
      endpoint: this.config.endpoint,
      capacitySource: {
        provider,
        tier,
        capacityType: provider === "local" ? "unlimited-local" : "tokens",
        sharedCapacity: sharePercent * 1000,
        modelAccess: provider === "anthropic" ? ["claude-sonnet-4"] : undefined,
      },
    });

    const res = await fetch(`${this.config.registryUrl}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to register worker: ${res.status} ${body}`);
    }

    console.log(`Worker registered — sharing capacity via ${this.config.registryUrl}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }

  get did(): string {
    return this.identity.did;
  }

  get handled(): number {
    return this.tasksHandled;
  }
}
