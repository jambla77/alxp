/**
 * Math Offload Demo — a local agent delegates math problems to a cloud agent.
 *
 * Usage: npx tsx examples/math-offload/index.ts
 *
 * The cloud agent actually evaluates the math expressions and returns results.
 */

import { ulid } from "ulid";
import {
  generateAgentIdentity,
  signString,
  ALXPServer,
  ALXPClient,
  generateAgentCard,
  AgentRegistry,
  createUCAN,
  ALXP_CAPABILITIES,
  ed25519ToX25519Public,
  ed25519ToX25519Private,
  createSealedEnvelope,
  decryptPayload,
} from "../../src/index.js";
import type {
  ProtocolMessage,
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
} from "../../src/types/index.js";

const LOCAL_PORT = 9820;
const CLOUD_PORT = 9821;

// ── The actual compute function the cloud agent runs ──
function solveMath(input: string): string {
  const lines = input.trim().split("\n");
  const results: string[] = [];

  for (const line of lines) {
    const expr = line.trim();
    if (!expr) continue;
    try {
      // Safe evaluation: only allow numbers and math operators
      if (!/^[\d\s+\-*/().%^]+$/.test(expr)) {
        results.push(`${expr} = ERROR: invalid expression`);
        continue;
      }
      const sanitized = expr.replace(/\^/g, "**");
      const answer = Function(`"use strict"; return (${sanitized})`)();
      results.push(`${expr} = ${answer}`);
    } catch {
      results.push(`${expr} = ERROR: could not evaluate`);
    }
  }

  return results.join("\n");
}

async function main() {
  console.log("=== ALXP: Math Offload Demo ===\n");

  // ── Identities ──
  const localAgent = generateAgentIdentity(`http://localhost:${LOCAL_PORT}`);
  const cloudAgent = generateAgentIdentity(`http://localhost:${CLOUD_PORT}`);

  console.log(`Local agent:  ${localAgent.did.slice(0, 40)}...`);
  console.log(`Cloud agent:  ${cloudAgent.did.slice(0, 40)}...`);

  // ── Registry ──
  const registry = new AgentRegistry();
  const cloudCard = generateAgentCard({
    identity: cloudAgent,
    capabilities: [
      {
        domain: "math",
        subDomain: "arithmetic",
        confidenceLevel: 1.0,
        tags: ["math", "compute", "arithmetic"],
      },
    ],
    trustTier: "consortium",
    endpoint: `http://localhost:${CLOUD_PORT}`,
    costModel: {
      basePrice: { amount: 0.001, currency: "USD", model: "fixed" },
      currency: "USD",
    },
    modelInfo: {
      provider: "compute-node",
      modelId: "math-engine-v1",
      contextWindow: 10000,
    },
  });
  registry.register(cloudCard);

  // ── The math problems to solve ──
  const mathProblems = `
(42 + 58) * 3
1024 / 16
2 ^ 10
(99 - 33) * (12 + 8)
7 * 8 + 6 * 9
(100 % 7) + (200 % 13)
  `.trim();

  console.log(`\n--- Math Problems ---`);
  console.log(mathProblems);

  // ── Discovery ──
  console.log("\nLocal agent: I need a compute agent for math...");
  const candidates = registry.query({
    domain: "math",
    minConfidence: 0.9,
    maxPrice: 0.01,
  });

  if (candidates.length === 0) {
    console.log("No capable agents found!");
    return;
  }

  const selected = candidates[0]!;
  console.log(`Found: ${selected.id.slice(0, 40)}... (confidence: ${selected.capabilities[0]!.confidenceLevel})\n`);

  // ── Servers ──
  const localServer = new ALXPServer();
  const cloudServer = new ALXPServer();
  const localClient = new ALXPClient(localAgent.did, localAgent.keyPair.privateKey);
  const cloudClient = new ALXPClient(cloudAgent.did, cloudAgent.keyPair.privateKey);

  const localReceived: ProtocolMessage[] = [];

  localServer.router.on("BID", async (msg) => { localReceived.push(msg); });
  localServer.router.on("SUBMIT_RESULT", async (msg) => { localReceived.push(msg); });

  // ── Cloud agent handler: actually computes the math ──
  cloudServer.router.on("ANNOUNCE_TASK", async () => {});
  cloudServer.router.on("AWARD", async (msg) => {
    const payload = msg.payload as { type: "AWARD"; contract: any; contextEnvelope?: any };
    const { contract, contextEnvelope } = payload;

    console.log("Cloud agent: Task awarded, decrypting context...");

    // Decrypt the input
    const cloudX25519Priv = ed25519ToX25519Private(cloudAgent.keyPair.privateKey);
    const decryptedInput = await decryptPayload(
      contextEnvelope.payloads[0].data,
      cloudX25519Priv,
    );
    console.log(`Cloud agent: Received ${decryptedInput.length} chars of math problems`);

    // Actually solve the math
    console.log("Cloud agent: Computing...");
    const solution = solveMath(decryptedInput);
    console.log(`Cloud agent: Done!\n`);

    // Submit result
    const resultId = ulid();
    const resultBundle = {
      id: resultId,
      contractId: contract.id,
      worker: cloudAgent.did,
      submitted: new Date().toISOString(),
      outputs: [{
        name: "solutions",
        mimeType: "text/plain",
        data: solution,
        encoding: "utf-8" as const,
      }],
      provenance: {
        agentId: cloudAgent.did,
        modelId: "math-engine-v1",
        startedAt: new Date(Date.now() - 100).toISOString(),
        completedAt: new Date().toISOString(),
      },
      selfAssessment: { confidence: 1.0 },
      signature: signString(resultId, cloudAgent.keyPair.privateKey),
    };

    await cloudClient.send(
      `http://localhost:${LOCAL_PORT}`,
      { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
      { recipient: localAgent.did },
    );
  });

  cloudServer.router.on("VERIFY", async (msg) => {
    const verdict = (msg.payload as { type: "VERIFY"; verdict: string }).verdict;
    console.log(`Cloud agent: Verification received — ${verdict}`);
  });

  await localServer.listen(LOCAL_PORT);
  await cloudServer.listen(CLOUD_PORT);

  // ── Announce task ──
  const taskId = ulid();
  const taskSpec = {
    id: taskId,
    requester: localAgent.did,
    created: new Date().toISOString(),
    objective: "Evaluate these arithmetic expressions",
    domain: "math",
    inputs: [{ name: "expressions", mimeType: "text/plain", data: mathProblems }],
    expectedOutput: {
      mimeType: "text/plain",
      description: "Each expression with its computed result",
    },
    privacyClass: "confidential" as const,
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
    verificationMethod: "optimistic" as const,
    tags: ["math", "arithmetic"],
    signature: signString(taskId, localAgent.keyPair.privateKey),
  };

  console.log("Local agent: Announcing task...");
  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
    { recipient: cloudAgent.did },
  );

  // Cloud agent bids
  const offerId = ulid();
  const offer = {
    id: offerId,
    taskId,
    worker: cloudAgent.did,
    created: new Date().toISOString(),
    expires: new Date(Date.now() + 3600000).toISOString(),
    price: { amount: 0.001, currency: "USD", model: "fixed" as const },
    estimatedDuration: "PT1S",
    confidence: 1.0,
    requiredContext: [],
    relevantReputation: [],
    relevantCredentials: [],
    signature: signString(offerId, cloudAgent.keyPair.privateKey),
  };

  await cloudClient.send(
    `http://localhost:${LOCAL_PORT}`,
    { type: "BID", offer } satisfies Bid,
    { recipient: localAgent.did },
  );
  console.log("Cloud agent: Bid submitted ($0.001)");

  // ── Award with encrypted context ──
  const contractId = ulid();
  const ucanToken = createUCAN({
    issuer: localAgent.did,
    issuerKey: localAgent.keyPair,
    audience: cloudAgent.did,
    capabilities: [
      { with: `alxp://context/*`, can: ALXP_CAPABILITIES.CONTEXT_READ },
      { with: `alxp://task/*`, can: ALXP_CAPABILITIES.TASK_SUBMIT },
    ],
    expiration: new Date(Date.now() + 3600000),
  });

  const cloudX25519Pub = ed25519ToX25519Public(cloudAgent.keyPair.publicKey);
  const { envelope: contextEnvelope } = await createSealedEnvelope({
    contractId,
    sender: localAgent.did,
    senderKey: localAgent.keyPair,
    recipient: cloudAgent.did,
    recipientX25519Public: cloudX25519Pub,
    payloads: [
      { name: "expressions", data: mathProblems, mimeType: "text/plain" },
    ],
    deleteOnCompletion: true,
    onwardTransfer: false,
  });

  const contract = {
    id: contractId,
    taskId,
    offerId,
    requester: localAgent.did,
    worker: cloudAgent.did,
    agreedPrice: offer.price,
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "schema-check" },
    delegationGrant: {
      issuer: localAgent.did,
      audience: cloudAgent.did,
      capabilities: ["context/read", "task/submit"],
      expiration: new Date(Date.now() + 3600000).toISOString(),
      token: ucanToken.sig,
    },
    cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
    requesterSignature: signString(contractId, localAgent.keyPair.privateKey),
    workerSignature: signString(contractId, cloudAgent.keyPair.privateKey),
    formed: new Date().toISOString(),
  };

  console.log("Local agent: Awarding task with encrypted context...\n");
  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "AWARD", contract, contextEnvelope } satisfies Award,
    { recipient: cloudAgent.did },
  );

  // Wait for result
  await waitFor(() => localReceived.some((m) => m.payload.type === "SUBMIT_RESULT"), 5000);

  const resultMsg = localReceived.find((m) => m.payload.type === "SUBMIT_RESULT")!;
  const result = (resultMsg.payload as { type: "SUBMIT_RESULT"; result: any }).result;

  console.log("--- Results ---");
  console.log(result.outputs[0].data);

  // ── Verify and settle ──
  const receiptId = ulid();
  const receipt = {
    id: receiptId,
    contractId,
    taskId,
    requester: localAgent.did,
    worker: cloudAgent.did,
    status: "accepted" as const,
    acceptedAt: new Date().toISOString(),
    qualityScore: 1.0,
    timelinessScore: 1.0,
    taskDomain: "math",
    amountSettled: offer.price,
    requesterSignature: signString(receiptId, localAgent.keyPair.privateKey),
    workerSignature: signString(receiptId, cloudAgent.keyPair.privateKey),
  };

  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "VERIFY", contractId, verdict: "accepted", receipt } satisfies Verify,
    { recipient: cloudAgent.did },
  );

  console.log(`\nTask settled! WorkReceipt ${receiptId.slice(0, 12)}... issued ($${receipt.amountSettled?.amount})`);

  await localServer.close();
  await cloudServer.close();
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
