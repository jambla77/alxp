/**
 * Ollama-to-Cloud Demo — a local agent offloads complex work to a cloud agent.
 *
 * Usage: npx tsx examples/ollama-to-cloud/index.ts
 *
 * This demonstrates the core ALXP use case: a resource-constrained local agent
 * (e.g., running Ollama on a laptop) delegates a complex task to a more capable
 * cloud agent. Everything runs in-process for this demo.
 *
 * Flow:
 * 1. Local agent (Ollama-like) starts with a user request
 * 2. It determines the task exceeds its capabilities
 * 3. It discovers a capable cloud agent via the registry
 * 4. It delegates the task via ALXP protocol
 * 5. Cloud agent processes and returns the result
 * 6. Local agent verifies and presents the result
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

const LOCAL_PORT = 9810;
const CLOUD_PORT = 9811;

async function main() {
  console.log("=== ALXP: Ollama-to-Cloud Offloading Demo ===\n");

  // ── Set up identities ──
  const localAgent = generateAgentIdentity(`http://localhost:${LOCAL_PORT}`);
  const cloudAgent = generateAgentIdentity(`http://localhost:${CLOUD_PORT}`);

  console.log(`Local agent (Ollama):  ${localAgent.did.slice(0, 40)}...`);
  console.log(`Cloud agent (Claude):  ${cloudAgent.did.slice(0, 40)}...`);

  // ── Set up registry and register cloud agent ──
  const registry = new AgentRegistry();

  const cloudCard = generateAgentCard({
    identity: cloudAgent,
    capabilities: [
      {
        domain: "code-review",
        subDomain: "python",
        confidenceLevel: 0.95,
        tags: ["python", "security", "best-practices"],
      },
      {
        domain: "summarization",
        confidenceLevel: 0.9,
        tags: ["text", "documents"],
      },
    ],
    trustTier: "consortium",
    endpoint: `http://localhost:${CLOUD_PORT}`,
    costModel: {
      basePrice: { amount: 0.05, currency: "USD", model: "fixed" },
      currency: "USD",
    },
    modelInfo: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      contextWindow: 200000,
    },
  });
  registry.register(cloudCard);
  console.log(`\nCloud agent registered in discovery registry`);

  // ── Step 1: Local agent receives a user request ──
  const userRequest = `
Review this Python code for security issues:

def process_user_input(user_data):
    query = f"SELECT * FROM users WHERE name = '{user_data}'"
    result = db.execute(query)
    return eval(result[0]['config'])
  `.trim();

  console.log(`\n--- User Request ---`);
  console.log(userRequest.slice(0, 80) + "...\n");

  // ── Step 2: Local agent determines it needs help ──
  console.log("Local agent: This code review task exceeds my capabilities.");
  console.log("Local agent: Searching for a capable agent...\n");

  // ── Step 3: Discover a capable cloud agent ──
  const candidates = registry.query({
    domain: "code-review",
    subDomain: "python",
    minConfidence: 0.8,
    maxPrice: 0.10,
  });

  if (candidates.length === 0) {
    console.log("No capable agents found!");
    return;
  }

  const selectedAgent = candidates[0]!;
  console.log(`Found ${candidates.length} capable agent(s). Selected: ${selectedAgent.id.slice(0, 40)}...`);
  console.log(`  Confidence: ${selectedAgent.capabilities[0]!.confidenceLevel}`);
  console.log(`  Price: $${selectedAgent.costModel?.basePrice?.amount}`);
  console.log(`  Model: ${selectedAgent.modelInfo?.modelId}\n`);

  // ── Step 4: Set up servers and delegate the task ──
  const localServer = new ALXPServer();
  const cloudServer = new ALXPServer();
  const localClient = new ALXPClient(localAgent.did, localAgent.keyPair.privateKey);
  const cloudClient = new ALXPClient(cloudAgent.did, cloudAgent.keyPair.privateKey);

  // Track messages
  const localReceived: ProtocolMessage[] = [];
  const cloudReceived: ProtocolMessage[] = [];

  localServer.router.on("BID", async (msg) => { localReceived.push(msg); });
  localServer.router.on("SUBMIT_RESULT", async (msg) => { localReceived.push(msg); });

  cloudServer.router.on("ANNOUNCE_TASK", async (msg) => { cloudReceived.push(msg); });
  cloudServer.router.on("AWARD", async (msg) => { cloudReceived.push(msg); });
  cloudServer.router.on("VERIFY", async (msg) => { cloudReceived.push(msg); });

  await localServer.listen(LOCAL_PORT);
  await cloudServer.listen(CLOUD_PORT);

  // Create UCAN delegation token
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
  console.log(`UCAN delegation token created: ${ucanToken.id.slice(0, 12)}...`);

  // Announce task
  const taskId = ulid();
  const taskSpec = {
    id: taskId,
    requester: localAgent.did,
    created: new Date().toISOString(),
    objective: "Review this Python code for security vulnerabilities and suggest fixes",
    domain: "code-review",
    inputs: [{ name: "code", mimeType: "text/x-python", data: userRequest }],
    expectedOutput: {
      mimeType: "text/plain",
      description: "Security review with identified vulnerabilities and fixes",
    },
    privacyClass: "confidential" as const,
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
    verificationMethod: "optimistic" as const,
    tags: ["code-review", "python", "security"],
    signature: signString(taskId, localAgent.keyPair.privateKey),
  };

  console.log("\nLocal agent: Announcing task to cloud agent...");
  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
    { recipient: cloudAgent.did },
  );

  // Cloud agent auto-bids
  const offerId = ulid();
  const offer = {
    id: offerId,
    taskId,
    worker: cloudAgent.did,
    created: new Date().toISOString(),
    expires: new Date(Date.now() + 3600000).toISOString(),
    price: { amount: 0.05, currency: "USD", model: "fixed" as const },
    estimatedDuration: "PT30S",
    confidence: 0.95,
    requiredContext: [],
    relevantReputation: [],
    relevantCredentials: [],
    signature: signString(offerId, cloudAgent.keyPair.privateKey),
  };

  console.log("Cloud agent: Submitting bid...");
  await cloudClient.send(
    `http://localhost:${LOCAL_PORT}`,
    { type: "BID", offer } satisfies Bid,
    { recipient: localAgent.did },
  );

  // Local agent accepts and creates encrypted context
  const contractId = ulid();
  console.log("\nLocal agent: Accepting bid and sending encrypted context...");

  // Create encrypted context envelope
  const cloudX25519Pub = ed25519ToX25519Public(cloudAgent.keyPair.publicKey);
  const { envelope: contextEnvelope } = await createSealedEnvelope({
    contractId,
    sender: localAgent.did,
    senderKey: localAgent.keyPair,
    recipient: cloudAgent.did,
    recipientX25519Public: cloudX25519Pub,
    payloads: [
      { name: "code", data: userRequest, mimeType: "text/x-python" },
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

  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "AWARD", contract, contextEnvelope } satisfies Award,
    { recipient: cloudAgent.did },
  );

  // Cloud agent decrypts context and processes the task
  console.log("Cloud agent: Decrypting context...");
  const cloudX25519Priv = ed25519ToX25519Private(cloudAgent.keyPair.privateKey);
  const decryptedCode = await decryptPayload(
    contextEnvelope.payloads[0]!.data,
    cloudX25519Priv,
  );
  console.log(`Cloud agent: Decrypted ${decryptedCode.length} chars of code`);

  // Mock LLM response (in reality, this would call Claude/GPT)
  const reviewResult = `
## Security Review

### Critical Vulnerabilities Found:

1. **SQL Injection** (Line 2)
   \`query = f"SELECT * FROM users WHERE name = '{user_data}'"\`
   User input is directly interpolated into the SQL query.
   **Fix:** Use parameterized queries: \`db.execute("SELECT * FROM users WHERE name = ?", (user_data,))\`

2. **Code Injection via eval()** (Line 3)
   \`eval(result[0]['config'])\`
   Using eval() on database content allows arbitrary code execution.
   **Fix:** Use \`json.loads()\` or a safe parser instead of eval().

### Severity: CRITICAL
Both vulnerabilities allow remote code execution.
  `.trim();

  // Submit result
  const resultId = ulid();
  const resultBundle = {
    id: resultId,
    contractId,
    worker: cloudAgent.did,
    submitted: new Date().toISOString(),
    outputs: [{
      name: "review",
      mimeType: "text/markdown",
      data: reviewResult,
      encoding: "utf-8" as const,
    }],
    provenance: {
      agentId: cloudAgent.did,
      modelId: "claude-sonnet-4-20250514",
      startedAt: new Date(Date.now() - 2000).toISOString(),
      completedAt: new Date().toISOString(),
      description: "Analyzed Python code for security vulnerabilities",
    },
    selfAssessment: { confidence: 0.95, notes: "Clear SQL injection and eval() vulnerabilities" },
    computeUsed: { inputTokens: 150, outputTokens: 200, totalDurationMs: 2000 },
    signature: signString(resultId, cloudAgent.keyPair.privateKey),
  };

  console.log("Cloud agent: Submitting review result...\n");
  await cloudClient.send(
    `http://localhost:${LOCAL_PORT}`,
    { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
    { recipient: localAgent.did },
  );

  // Wait for result
  await new Promise((r) => setTimeout(r, 200));

  // Local agent receives and verifies
  console.log("--- Cloud Agent's Review ---");
  console.log(reviewResult);

  // Accept and issue receipt
  const receiptId = ulid();
  const receipt = {
    id: receiptId,
    contractId,
    taskId,
    requester: localAgent.did,
    worker: cloudAgent.did,
    status: "accepted" as const,
    acceptedAt: new Date().toISOString(),
    qualityScore: 0.95,
    timelinessScore: 1.0,
    taskDomain: "code-review",
    taskComplexity: 0.5,
    amountSettled: offer.price,
    requesterSignature: signString(receiptId, localAgent.keyPair.privateKey),
    workerSignature: signString(receiptId, cloudAgent.keyPair.privateKey),
  };

  await localClient.send(
    `http://localhost:${CLOUD_PORT}`,
    { type: "VERIFY", contractId, verdict: "accepted", receipt } satisfies Verify,
    { recipient: cloudAgent.did },
  );

  console.log("\n--- Task Complete ---");
  console.log(`WorkReceipt ${receiptId.slice(0, 12)}... issued`);
  console.log(`Quality: ${receipt.qualityScore}, Settled: $${receipt.amountSettled?.amount}`);
  console.log(`Context was encrypted (X25519 + AES-256-GCM) and scoped to this contract`);
  console.log(`UCAN delegation ensured cloud agent could only read context, not re-delegate`);

  await localServer.close();
  await cloudServer.close();
  process.exit(0);
}

main().catch(console.error);
