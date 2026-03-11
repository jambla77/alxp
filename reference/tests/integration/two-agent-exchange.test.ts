import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity, type AgentIdentity } from "../../src/identity/did.js";
import { signString, publicKeyToHex } from "../../src/identity/signing.js";
import { createMessage, verifyMessage } from "../../src/messages/envelope.js";
import { ALXPServer } from "../../src/transport/http-server.js";
import { ALXPClient } from "../../src/transport/http-client.js";
import { TaskStateMachine } from "../../src/lifecycle/state-machine.js";
import type {
  ProtocolMessage,
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
  Settle,
} from "../../src/types/index.js";

/**
 * Integration test: Two agents complete a full task exchange.
 *
 * 1. Agent A (requester) generates a DID and starts an ALXP server
 * 2. Agent B (worker) generates a DID and starts an ALXP server
 * 3. Agent A announces a task: "Summarize this paragraph"
 * 4. Agent B discovers the task and submits a bid
 * 5. Agent A accepts the bid → TaskContract formed
 * 6. Agent A sends context (the paragraph) in the Award message
 * 7. Agent B "processes" the task (mock: returns a summary)
 * 8. Agent B submits a ResultBundle
 * 9. Agent A verifies (schema check) and accepts
 * 10. WorkReceipt is issued, signed by both parties
 * 11. Assert: all state transitions were valid
 * 12. Assert: all messages have valid signatures
 * 13. Assert: WorkReceipt is dual-signed
 */
describe("Two-agent task exchange", () => {
  let agentA: AgentIdentity;
  let agentB: AgentIdentity;
  let serverA: ALXPServer;
  let serverB: ALXPServer;
  let clientA: ALXPClient;
  let clientB: ALXPClient;

  const PORT_A = 9710;
  const PORT_B = 9711;

  const allMessages: ProtocolMessage[] = [];

  afterAll(async () => {
    await serverA?.close();
    await serverB?.close();
  });

  it("completes the full lifecycle", async () => {
    // ── Step 1: Both agents generate identities and start servers ──
    agentA = generateAgentIdentity(`http://localhost:${PORT_A}`);
    agentB = generateAgentIdentity(`http://localhost:${PORT_B}`);

    serverA = new ALXPServer();
    serverB = new ALXPServer();

    // Track state machine for the task
    const taskId = ulid();
    const sm = new TaskStateMachine(taskId, agentA.did, agentB.did);

    // ── Set up handlers ──
    // Agent B receives ANNOUNCE_TASK and AWARD messages
    const receivedByB: ProtocolMessage[] = [];
    serverB.router.on("ANNOUNCE_TASK", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("AWARD", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("VERIFY", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("SETTLE", async (msg) => {
      receivedByB.push(msg);
    });

    // Agent A receives BID, SUBMIT_RESULT messages
    const receivedByA: ProtocolMessage[] = [];
    serverA.router.on("BID", async (msg) => {
      receivedByA.push(msg);
    });
    serverA.router.on("SUBMIT_RESULT", async (msg) => {
      receivedByA.push(msg);
    });

    await serverA.listen(PORT_A);
    await serverB.listen(PORT_B);

    clientA = new ALXPClient(agentA.did, agentA.keyPair.privateKey);
    clientB = new ALXPClient(agentB.did, agentB.keyPair.privateKey);

    // ── Step 3: Agent A announces a task ──
    const taskSpec = {
      id: taskId,
      requester: agentA.did,
      created: new Date().toISOString(),
      objective: "Summarize this paragraph into one sentence",
      domain: "summarization",
      inputs: [
        {
          name: "paragraph",
          mimeType: "text/plain",
          data: "The Agent Labor Exchange Protocol enables AI agents to request, negotiate, and complete tasks for other AI agents. It provides a standardized way for agents to exchange labor across different model providers and hosting environments.",
        },
      ],
      expectedOutput: {
        mimeType: "text/plain",
        description: "A one-sentence summary",
      },
      privacyClass: "public" as const,
      delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
      acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
      verificationMethod: "optimistic" as const,
      tags: ["summarization", "test"],
      signature: signString(taskId, agentA.keyPair.privateKey),
    };

    const announceMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
      recipient: agentB.did,
    });
    allMessages.push(announceMsg);

    const announceResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, announceMsg);
    expect(announceResp.result).toBeDefined();
    expect(receivedByB).toHaveLength(1);

    // Transition: POSTED → BIDDING
    sm.transition("first_offer_received");
    expect(sm.state).toBe("BIDDING");

    // ── Step 4: Agent B submits a bid ──
    const offerId = ulid();
    const offer = {
      id: offerId,
      taskId,
      worker: agentB.did,
      created: new Date().toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
      price: { amount: 0.01, currency: "USD", model: "fixed" as const },
      estimatedDuration: "PT5M",
      confidence: 0.95,
      requiredContext: [],
      relevantReputation: [],
      relevantCredentials: [],
      signature: signString(offerId, agentB.keyPair.privateKey),
    };

    const bidMsg = createMessage({
      sender: agentB.did,
      privateKey: agentB.keyPair.privateKey,
      payload: { type: "BID", offer } satisfies Bid,
      recipient: agentA.did,
    });
    allMessages.push(bidMsg);

    const bidResp = await clientB.sendRaw(`http://localhost:${PORT_A}`, bidMsg);
    expect(bidResp.result).toBeDefined();
    expect(receivedByA).toHaveLength(1);

    // ── Step 5: Agent A accepts the bid → TaskContract formed ──
    // Transition: BIDDING → AWARDED
    sm.transition("offer_accepted", ["requester", "worker"]);
    expect(sm.state).toBe("AWARDED");

    const contractId = ulid();
    const contract = {
      id: contractId,
      taskId,
      offerId,
      requester: agentA.did,
      worker: agentB.did,
      agreedPrice: { amount: 0.01, currency: "USD", model: "fixed" as const },
      agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
      agreedVerification: { method: "schema-check", description: "Output must be a string" },
      delegationGrant: {
        issuer: agentA.did,
        audience: agentB.did,
        capabilities: ["context/read"],
        expiration: new Date(Date.now() + 3600000).toISOString(),
        token: signString(`${contractId}:grant`, agentA.keyPair.privateKey),
      },
      cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
      requesterSignature: signString(contractId, agentA.keyPair.privateKey),
      workerSignature: signString(contractId, agentB.keyPair.privateKey),
      formed: new Date().toISOString(),
    };

    // ── Step 6: Send Award with context ──
    const contextEnvelope = {
      id: ulid(),
      contractId,
      sender: agentA.did,
      recipient: agentB.did,
      payloads: [
        {
          name: "paragraph",
          mimeType: "text/plain",
          data: taskSpec.inputs[0]!.data!,
          encoding: "utf-8" as const,
        },
      ],
      references: [],
      encryption: {
        algorithm: "none",
        recipientPublicKey: publicKeyToHex(agentB.keyPair.publicKey),
      },
      retentionPolicy: { deleteOnCompletion: true },
      onwardTransfer: false,
      expires: new Date(Date.now() + 3600000).toISOString(),
      signature: signString(contractId + ":context", agentA.keyPair.privateKey),
    };

    const awardMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: { type: "AWARD", contract, contextEnvelope } satisfies Award,
      recipient: agentB.did,
    });
    allMessages.push(awardMsg);

    const awardResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, awardMsg);
    expect(awardResp.result).toBeDefined();

    // Transition: AWARDED → RUNNING
    sm.transition("context_transferred", ["requester"]);
    expect(sm.state).toBe("RUNNING");

    // ── Step 7 & 8: Agent B "processes" the task and submits result ──
    const resultId = ulid();
    const resultBundle = {
      id: resultId,
      contractId,
      worker: agentB.did,
      submitted: new Date().toISOString(),
      outputs: [
        {
          name: "summary",
          mimeType: "text/plain",
          data: "ALXP is a protocol that standardizes AI agent labor exchange across providers and environments.",
          encoding: "utf-8" as const,
        },
      ],
      provenance: {
        agentId: agentB.did,
        modelId: "test-model",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date().toISOString(),
        description: "Summarized the paragraph into one sentence",
      },
      selfAssessment: {
        confidence: 0.9,
        notes: "Straightforward summarization task",
      },
      signature: signString(resultId, agentB.keyPair.privateKey),
    };

    // Transition: RUNNING → SUBMITTED
    sm.transition("result_submitted", ["worker"]);
    expect(sm.state).toBe("SUBMITTED");

    const submitMsg = createMessage({
      sender: agentB.did,
      privateKey: agentB.keyPair.privateKey,
      payload: { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
      recipient: agentA.did,
    });
    allMessages.push(submitMsg);

    const submitResp = await clientB.sendRaw(`http://localhost:${PORT_A}`, submitMsg);
    expect(submitResp.result).toBeDefined();

    // ── Step 9: Agent A verifies and accepts ──
    // Transition: SUBMITTED → REVIEWING
    sm.transition("review_started", ["requester"]);
    expect(sm.state).toBe("REVIEWING");

    // Verify the output (simple schema check: it's a string)
    const output = resultBundle.outputs[0]!.data;
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);

    // Transition: REVIEWING → ACCEPTED
    sm.transition("result_accepted", ["requester"]);
    expect(sm.state).toBe("ACCEPTED");

    // ── Step 10: Issue WorkReceipt, signed by both parties ──
    const receiptId = ulid();
    const receipt = {
      id: receiptId,
      contractId,
      taskId,
      requester: agentA.did,
      worker: agentB.did,
      status: "accepted" as const,
      acceptedAt: new Date().toISOString(),
      qualityScore: 0.9,
      timelinessScore: 1.0,
      taskDomain: "summarization",
      taskComplexity: 0.3,
      amountSettled: { amount: 0.01, currency: "USD", model: "fixed" as const },
      requesterSignature: signString(receiptId, agentA.keyPair.privateKey),
      workerSignature: signString(receiptId, agentB.keyPair.privateKey),
    };

    const verifyMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: {
        type: "VERIFY",
        contractId,
        verdict: "accepted",
        receipt,
      } satisfies Verify,
      recipient: agentB.did,
    });
    allMessages.push(verifyMsg);

    const verifyResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, verifyMsg);
    expect(verifyResp.result).toBeDefined();

    // ── Settlement ──
    // Transition: ACCEPTED → SETTLED
    sm.transition("payment_released", ["requester", "worker"]);
    expect(sm.state).toBe("SETTLED");

    const settleMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: {
        type: "SETTLE",
        contractId,
        receipt,
      } satisfies Settle,
      recipient: agentB.did,
    });
    allMessages.push(settleMsg);

    const settleResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, settleMsg);
    expect(settleResp.result).toBeDefined();

    // ── Assertions ──

    // 11. Assert: all state transitions were valid
    expect(sm.isTerminal()).toBe(true);
    expect(sm.state).toBe("SETTLED");
    // 7 transitions: first_offer_received, offer_accepted, context_transferred,
    // result_submitted, review_started, result_accepted, payment_released
    expect(sm.history).toHaveLength(7);

    // Verify the full transition path
    const states = sm.history.map((h) => h.to);
    expect(states).toEqual([
      "BIDDING",
      "AWARDED",
      "RUNNING",
      "SUBMITTED",
      "REVIEWING",
      "ACCEPTED",
      "SETTLED",
    ]);

    // 12. Assert: all messages have valid signatures
    for (const msg of allMessages) {
      expect(verifyMessage(msg)).toBe(true);
    }

    // 13. Assert: WorkReceipt is dual-signed
    expect(receipt.requesterSignature).toBeTruthy();
    expect(receipt.workerSignature).toBeTruthy();

    // Verify requester's receipt signature
    const requesterSigValid = (await import("../../src/identity/signing.js")).verifyString(
      receipt.requesterSignature,
      receiptId,
      agentA.keyPair.publicKey,
    );
    expect(requesterSigValid).toBe(true);

    // Verify worker's receipt signature
    const workerSigValid = (await import("../../src/identity/signing.js")).verifyString(
      receipt.workerSignature,
      receiptId,
      agentB.keyPair.publicKey,
    );
    expect(workerSigValid).toBe(true);

    // Verify messages were received by the correct agents
    expect(receivedByA.length).toBe(2); // BID, SUBMIT_RESULT
    expect(receivedByB.length).toBe(4); // ANNOUNCE_TASK, AWARD, VERIFY, SETTLE
  });
});
