/**
 * Simple Requester Agent — posts a task and accepts the result.
 *
 * Usage: npx tsx examples/simple-requester/index.ts
 *
 * This example demonstrates the requester side of the ALXP protocol:
 * 1. Generate an agent identity
 * 2. Start an ALXP server (to receive bids and results)
 * 3. Announce a task to a worker agent
 * 4. Accept a bid and form a contract
 * 5. Verify and accept the result
 * 6. Issue a dual-signed WorkReceipt
 */

import { ulid } from "ulid";
import {
  generateAgentIdentity,
  signString,
  ALXPServer,
  ALXPClient,
  createMessage,
  TaskStateMachine,
} from "../../src/index.js";
import type {
  ProtocolMessage,
  AnnounceTask,
  Award,
  Verify,
  Settle,
} from "../../src/types/index.js";

const PORT = 9800;
const WORKER_PORT = 9801;

async function main() {
  // 1. Generate identity
  const identity = generateAgentIdentity(`http://localhost:${PORT}`);
  console.log(`Requester agent: ${identity.did}`);

  // 2. Start server
  const server = new ALXPServer();
  const client = new ALXPClient(identity.did, identity.keyPair.privateKey);

  const receivedMessages: ProtocolMessage[] = [];
  server.router.on("BID", async (msg) => {
    console.log(`Received bid from ${msg.sender}`);
    receivedMessages.push(msg);
  });
  server.router.on("SUBMIT_RESULT", async (msg) => {
    console.log(`Received result from ${msg.sender}`);
    receivedMessages.push(msg);
  });

  await server.listen(PORT);
  console.log(`Requester listening on port ${PORT}`);

  // 3. Create and announce a task
  const taskId = ulid();
  const sm = new TaskStateMachine(taskId, identity.did);

  const taskSpec = {
    id: taskId,
    requester: identity.did,
    created: new Date().toISOString(),
    objective: "Summarize this paragraph into one sentence",
    domain: "summarization",
    inputs: [{
      name: "paragraph",
      mimeType: "text/plain",
      data: "The Agent Labor Exchange Protocol (ALXP) enables AI agents to request, negotiate, and complete tasks for other AI agents. It is designed as an open protocol, not a platform, allowing interoperability across different model providers, agent frameworks, and hosting environments.",
    }],
    expectedOutput: {
      mimeType: "text/plain",
      description: "A one-sentence summary",
    },
    privacyClass: "public" as const,
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
    verificationMethod: "optimistic" as const,
    tags: ["summarization"],
    signature: signString(taskId, identity.keyPair.privateKey),
  };

  console.log(`\nAnnouncing task: "${taskSpec.objective}"`);
  const announceResp = await client.send(
    `http://localhost:${WORKER_PORT}`,
    { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
  );
  console.log(`Announce response:`, announceResp.result ? "OK" : announceResp.error?.message);
  sm.transition("first_offer_received");

  // 4. Wait for bid, then accept
  await waitFor(() => receivedMessages.some((m) => m.payload.type === "BID"), 5000);
  const bidMsg = receivedMessages.find((m) => m.payload.type === "BID")!;
  const offer = (bidMsg.payload as { type: "BID"; offer: any }).offer;
  console.log(`\nAccepting bid from ${offer.worker} (price: $${offer.price.amount})`);

  sm.transition("offer_accepted", ["requester", "worker"]);

  const contractId = ulid();
  const contract = {
    id: contractId,
    taskId,
    offerId: offer.id,
    requester: identity.did,
    worker: offer.worker,
    agreedPrice: offer.price,
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "schema-check" },
    delegationGrant: {
      issuer: identity.did,
      audience: offer.worker,
      capabilities: ["context/read"],
      expiration: new Date(Date.now() + 3600000).toISOString(),
      token: signString(`${contractId}:grant`, identity.keyPair.privateKey),
    },
    cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
    requesterSignature: signString(contractId, identity.keyPair.privateKey),
    workerSignature: signString(contractId, identity.keyPair.privateKey), // In reality, worker would co-sign
    formed: new Date().toISOString(),
  };

  await client.send(
    `http://localhost:${WORKER_PORT}`,
    { type: "AWARD", contract } satisfies Award,
    { recipient: offer.worker },
  );
  sm.transition("context_transferred", ["requester"]);
  console.log("Contract formed, task running");

  // 5. Wait for result
  await waitFor(() => receivedMessages.some((m) => m.payload.type === "SUBMIT_RESULT"), 5000);
  sm.transition("result_submitted", ["worker"]);
  sm.transition("review_started", ["requester"]);

  const resultMsg = receivedMessages.find((m) => m.payload.type === "SUBMIT_RESULT")!;
  const result = (resultMsg.payload as { type: "SUBMIT_RESULT"; result: any }).result;
  console.log(`\nResult received: "${result.outputs[0].data}"`);

  // 6. Accept and issue receipt
  sm.transition("result_accepted", ["requester"]);

  const receiptId = ulid();
  const receipt = {
    id: receiptId,
    contractId,
    taskId,
    requester: identity.did,
    worker: offer.worker,
    status: "accepted" as const,
    acceptedAt: new Date().toISOString(),
    qualityScore: 0.9,
    timelinessScore: 1.0,
    taskDomain: "summarization",
    requesterSignature: signString(receiptId, identity.keyPair.privateKey),
    workerSignature: signString(receiptId, identity.keyPair.privateKey), // Worker would co-sign
  };

  await client.send(
    `http://localhost:${WORKER_PORT}`,
    { type: "VERIFY", contractId, verdict: "accepted", receipt } satisfies Verify,
    { recipient: offer.worker },
  );

  sm.transition("payment_released", ["requester", "worker"]);
  console.log(`\nTask settled! Final state: ${sm.state}`);
  console.log(`Lifecycle: ${sm.history.map((h) => `${h.from}->${h.to}`).join(", ")}`);

  await server.close();
  process.exit(0);
}

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Timeout"));
      setTimeout(check, 50);
    };
    check();
  });
}

main().catch(console.error);
