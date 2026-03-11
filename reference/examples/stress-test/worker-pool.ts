/**
 * Worker Pool — launches N workers that register with the registry
 * and handle incoming tasks with real computation.
 *
 * Can run standalone on a remote machine:
 *   npx tsx examples/stress-test/worker-pool.ts \
 *     --registry http://192.168.2.X:19600 --count 25 --port-start 19700
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
import { solveTask } from "./task-solvers.js";
import { parseConfig, type StressConfig } from "./config.js";

interface WorkerAgent {
  identity: AgentIdentity;
  server: ALXPServer;
  client: ALXPClient;
  port: number;
  endpoint: string;
  tasksHandled: number;
}

export class WorkerPool {
  private workers: WorkerAgent[] = [];

  constructor(private config: StressConfig) {}

  async start(): Promise<void> {
    const { workerCount, workerPortStart, registryUrl, localIp } = this.config;
    console.log(`Starting ${workerCount} workers on ports ${workerPortStart}-${workerPortStart + workerCount - 1}...`);

    // Create all workers
    const startups: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      startups.push(this.startWorker(i));
    }
    await Promise.all(startups);

    // Register all with registry
    console.log(`Registering ${workerCount} workers with registry at ${registryUrl}...`);
    const registrations: Promise<void>[] = [];
    for (const worker of this.workers) {
      registrations.push(this.registerWorker(worker));
    }
    await Promise.all(registrations);

    console.log(`All ${workerCount} workers registered and ready.`);
  }

  private async startWorker(index: number): Promise<void> {
    const port = this.config.workerPortStart + index;
    const hostname = this.config.localOnly ? "127.0.0.1" : "0.0.0.0";
    const endpointIp = this.config.localOnly ? "127.0.0.1" : this.config.localIp;
    const endpoint = `http://${endpointIp}:${port}`;

    const identity = generateAgentIdentity(endpoint);
    const server = new ALXPServer();
    const client = new ALXPClient(identity.did, identity.keyPair.privateKey);

    const worker: WorkerAgent = { identity, server, client, port, endpoint, tasksHandled: 0 };
    this.workers.push(worker);

    // Handle ANNOUNCE_TASK — auto-bid
    server.router.on("ANNOUNCE_TASK", async (msg) => {
      const taskSpec = (msg.payload as { type: "ANNOUNCE_TASK"; taskSpec: any }).taskSpec;
      const replyEndpoint = msg.headers?.["reply-endpoint"];
      if (!replyEndpoint) {
        console.error(`Worker ${index}: no reply-endpoint header`);
        return;
      }

      const offerId = ulid();
      const offer = {
        id: offerId,
        taskId: taskSpec.id,
        worker: identity.did,
        created: new Date().toISOString(),
        expires: new Date(Date.now() + 3600000).toISOString(),
        price: { amount: 0.001, currency: "USD", model: "fixed" as const },
        estimatedDuration: "PT10S",
        confidence: 0.99,
        requiredContext: [],
        relevantReputation: [],
        relevantCredentials: [],
        signature: signString(offerId, identity.keyPair.privateKey),
      };

      await client.send(
        replyEndpoint,
        { type: "BID", offer } satisfies Bid,
        { recipient: msg.sender },
      );
    });

    // Handle AWARD — do computation, submit result
    server.router.on("AWARD", async (msg) => {
      const contract = (msg.payload as { type: "AWARD"; contract: any }).contract;
      const replyEndpoint = msg.headers?.["reply-endpoint"];
      if (!replyEndpoint) {
        console.error(`Worker ${index}: no reply-endpoint on AWARD`);
        return;
      }

      // The task input is encoded in the contract's headers or we extract from context
      // For this stress test, the input is stored as a header on the message
      const inputJson = msg.headers?.["task-input"];
      if (!inputJson) {
        console.error(`Worker ${index}: no task-input header`);
        return;
      }

      const input = JSON.parse(inputJson);
      const { result } = solveTask(input);

      const resultId = ulid();
      const resultBundle = {
        id: resultId,
        contractId: contract.id,
        worker: identity.did,
        submitted: new Date().toISOString(),
        outputs: [{
          name: "result",
          mimeType: "application/json",
          data: JSON.stringify(result),
          encoding: "utf-8" as const,
        }],
        provenance: {
          agentId: identity.did,
          modelId: `stress-worker-${index}`,
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        },
        selfAssessment: { confidence: 0.99 },
        signature: signString(resultId, identity.keyPair.privateKey),
      };

      await client.send(
        replyEndpoint,
        { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
        { recipient: msg.sender },
      );
      worker.tasksHandled++;
    });

    await server.listen(port, hostname);
  }

  private async registerWorker(worker: WorkerAgent): Promise<void> {
    const card = generateAgentCard({
      identity: worker.identity,
      name: `stress-worker`,
      description: "Stress test computation worker",
      capabilities: [{
        domain: "computation",
        subDomain: "general",
        tags: ["math", "string", "sorting"],
        confidenceLevel: 0.99,
      }],
      trustTier: "same-owner",
      endpoint: worker.endpoint,
    });

    const res = await fetch(`${this.config.registryUrl}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to register worker on port ${worker.port}: ${res.status} ${body}`);
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.server.close()));
  }

  get count(): number {
    return this.workers.length;
  }
}

// ── Standalone entry point ──
if (process.argv[1]?.includes("worker-pool")) {
  // Verify we're running from the reference/ directory
  const fs = await import("fs");
  if (!fs.existsSync("src/index.ts") && !fs.existsSync("src/index.js")) {
    console.error("Error: worker-pool.ts must be run from the reference/ directory.");
    console.error("  cd reference && npx tsx examples/stress-test/worker-pool.ts ...");
    process.exit(1);
  }

  const config = parseConfig();
  const pool = new WorkerPool(config);

  process.on("SIGINT", async () => {
    console.log("\nShutting down workers...");
    await pool.stop();
    process.exit(0);
  });

  pool.start().then(() => {
    console.log(`\n${pool.count} workers running. Press Ctrl+C to stop.`);
  }).catch((err) => {
    console.error("Worker pool failed:", err);
    process.exit(1);
  });
}
