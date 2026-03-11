/**
 * Simple Worker Agent — accepts tasks and returns results.
 *
 * Usage: npx tsx examples/simple-worker/index.ts
 *        (then run simple-requester in another terminal)
 *
 * This example demonstrates the worker side of the ALXP protocol:
 * 1. Generate an agent identity
 * 2. Start an ALXP server (to receive task announcements)
 * 3. Receive a task announcement and submit a bid
 * 4. Receive the award and process the task
 * 5. Submit the result
 */

import { ulid } from "ulid";
import {
  generateAgentIdentity,
  signString,
  ALXPServer,
  ALXPClient,
} from "../../src/index.js";
import type {
  ProtocolMessage,
  Bid,
  SubmitResult,
} from "../../src/types/index.js";

const PORT = 9801;

async function main() {
  // 1. Generate identity
  const identity = generateAgentIdentity(`http://localhost:${PORT}`);
  console.log(`Worker agent: ${identity.did}`);

  // 2. Start server
  const server = new ALXPServer();
  const client = new ALXPClient(identity.did, identity.keyPair.privateKey);

  // 3. Handle incoming task announcements
  server.router.on("ANNOUNCE_TASK", async (msg) => {
    const taskSpec = (msg.payload as { type: "ANNOUNCE_TASK"; taskSpec: any }).taskSpec;
    console.log(`\nReceived task: "${taskSpec.objective}"`);
    console.log(`Domain: ${taskSpec.domain}, Requester: ${taskSpec.requester}`);

    // Auto-bid on the task
    const offerId = ulid();
    const offer = {
      id: offerId,
      taskId: taskSpec.id,
      worker: identity.did,
      created: new Date().toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
      price: { amount: 0.01, currency: "USD", model: "fixed" as const },
      estimatedDuration: "PT1M",
      confidence: 0.95,
      requiredContext: [],
      relevantReputation: [],
      relevantCredentials: [],
      signature: signString(offerId, identity.keyPair.privateKey),
    };

    console.log("Submitting bid...");
    const senderEndpoint = `http://localhost:9800`;

    await client.send(
      senderEndpoint,
      { type: "BID", offer } satisfies Bid,
      { recipient: msg.sender },
    );
    console.log("Bid submitted!");
  });

  // 4. Handle award — process the task
  server.router.on("AWARD", async (msg) => {
    const contract = (msg.payload as { type: "AWARD"; contract: any }).contract;
    console.log(`\nTask awarded! Contract: ${contract.id}`);

    // "Process" the task — in a real agent, this would call an LLM
    const input = contract.taskId; // We'd normally get context from the envelope
    const summary =
      "ALXP is an open protocol enabling AI agents to exchange labor across providers and environments.";

    console.log(`Processing task... Result: "${summary}"`);

    // 5. Submit result
    const resultId = ulid();
    const result = {
      id: resultId,
      contractId: contract.id,
      worker: identity.did,
      submitted: new Date().toISOString(),
      outputs: [{
        name: "summary",
        mimeType: "text/plain",
        data: summary,
        encoding: "utf-8" as const,
      }],
      provenance: {
        agentId: identity.did,
        modelId: "simple-worker-v1",
        startedAt: new Date(Date.now() - 1000).toISOString(),
        completedAt: new Date().toISOString(),
      },
      selfAssessment: { confidence: 0.9 },
      signature: signString(resultId, identity.keyPair.privateKey),
    };

    const senderEndpoint = `http://localhost:9800`;
    await client.send(
      senderEndpoint,
      { type: "SUBMIT_RESULT", result } satisfies SubmitResult,
      { recipient: msg.sender },
    );
    console.log("Result submitted!");
  });

  // Handle verification
  server.router.on("VERIFY", async (msg) => {
    const verdict = (msg.payload as { type: "VERIFY"; verdict: string }).verdict;
    console.log(`\nVerification received: ${verdict}`);
  });

  server.router.on("SETTLE", async (msg) => {
    console.log("\nSettlement received! Task complete.");
    setTimeout(() => {
      server.close().then(() => process.exit(0));
    }, 500);
  });

  await server.listen(PORT);
  console.log(`Worker listening on port ${PORT}`);
  console.log("Waiting for tasks...\n");
}

main().catch(console.error);
