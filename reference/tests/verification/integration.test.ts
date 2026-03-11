import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateAgentIdentity } from "../../src/identity/did.js";
import { signString } from "../../src/identity/signing.js";
import { canonicalize } from "../../src/messages/canonicalize.js";
import { VerificationEngine } from "../../src/verification/index.js";
import { OptimisticVerifier, MockStakingAdapter } from "../../src/verification/economic.js";
import { ConsensusVerifier, type ValidatorAgent } from "../../src/verification/consensus.js";
import { MerkleTreeBuilder } from "../../src/verification/merkle.js";
import type { TaskSpec, TaskContract, ResultBundle } from "../../src/types/index.js";

function makeTaskSpec(
  requester: ReturnType<typeof generateAgentIdentity>,
  acceptanceCriteria: TaskSpec["acceptanceCriteria"],
  verificationMethod: TaskSpec["verificationMethod"],
  overrides?: Partial<TaskSpec>,
): TaskSpec {
  const id = ulid();
  return {
    id,
    requester: requester.did,
    created: new Date().toISOString(),
    objective: "Test task",
    domain: "test",
    expectedOutput: { mimeType: "text/plain" },
    privacyClass: "public",
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria,
    verificationMethod,
    tags: [],
    signature: signString(id, requester.keyPair.privateKey),
    ...overrides,
  } as TaskSpec;
}

function makeContract(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
): TaskContract {
  const id = ulid();
  return {
    id,
    taskId: ulid(),
    offerId: ulid(),
    requester: requester.did,
    worker: worker.did,
    agreedPrice: { amount: 1.00, currency: "USD", model: "fixed" },
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "automated" },
    delegationGrant: {
      issuer: requester.did,
      audience: worker.did,
      capabilities: ["context/read"],
      expiration: new Date(Date.now() + 3600000).toISOString(),
      token: signString(id, requester.keyPair.privateKey),
    },
    cancellationPolicy: { allowedBy: "both", penaltyPercent: 0 },
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
    formed: new Date().toISOString(),
  } as TaskContract;
}

function makeResult(
  worker: ReturnType<typeof generateAgentIdentity>,
  contractId: string,
  data = "Good result",
): ResultBundle {
  const id = ulid();
  return {
    id,
    contractId,
    worker: worker.did,
    submitted: new Date().toISOString(),
    outputs: [{ name: "output", mimeType: "text/plain", data, encoding: "utf-8" }],
    provenance: {
      agentId: worker.did,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
    },
    signature: signString(id, worker.keyPair.privateKey),
  } as ResultBundle;
}

describe("VerificationEngine (integrated)", () => {
  it("automated verification: passes → settled", async () => {
    const engine = new VerificationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
      { type: "test", testSuite: "min-length:5" },
    ], "automated");

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id, "This is a valid output");

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(true);
    expect(verification.decidingTier).toBe("automated");
    expect(verification.automatedResult.checks).toHaveLength(2);
    expect(verification.qualityScore).toBe(1);
  });

  it("automated verification: fails → immediately rejected", async () => {
    const engine = new VerificationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
      { type: "hash", expectedHash: "wrong" },
    ], "automated");

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(false);
    expect(verification.decidingTier).toBe("automated");
    expect(verification.qualityScore).toBe(0.5); // 1 of 2 passed
  });

  it("optimistic verification: passes automated → starts challenge window", async () => {
    const adapter = new MockStakingAdapter();
    const optimisticVerifier = new OptimisticVerifier(adapter);
    const engine = new VerificationEngine(optimisticVerifier);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
    ], "optimistic", { challengeWindow: "PT1H" });

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id, "Valid output");

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(true);
    expect(verification.decidingTier).toBe("economic");
    expect(verification.economicState).toBeTruthy();
    expect(verification.economicState!.challengeDeadline).toBeTruthy();
    expect(verification.economicState!.challenged).toBe(false);
  });

  it("optimistic verification: fails automated → rejected before economic tier", async () => {
    const adapter = new MockStakingAdapter();
    const optimisticVerifier = new OptimisticVerifier(adapter);
    const engine = new VerificationEngine(optimisticVerifier);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
      { type: "test", testSuite: "contains:REQUIRED_KEYWORD" },
    ], "optimistic");

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id, "No keyword here");

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(false);
    expect(verification.decidingTier).toBe("automated");
    // Should NOT have economic state since it never reached Tier 2
    expect(verification.economicState).toBeUndefined();
  });

  it("consensus verification: 3 validators, 2 accept → passes", async () => {
    const consensusVerifier = new ConsensusVerifier();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // Register 3 validators
    for (let i = 0; i < 3; i++) {
      const v = generateAgentIdentity();
      consensusVerifier.registerValidator({
        did: v.did,
        domain: "test",
        reputation: 0.9,
        assess: async () => ({
          accepted: i < 2, // First 2 accept, last rejects
          qualityScore: i < 2 ? 0.85 : 0.3,
          reasoning: i < 2 ? "Looks good" : "Not great",
        }),
      });
    }

    const engine = new VerificationEngine(undefined, consensusVerifier);

    const taskSpec = makeTaskSpec(requester, [
      { type: "consensus", validators: 3, threshold: 0.66 },
    ], "consensus");

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(true);
    expect(verification.decidingTier).toBe("consensus");
    expect(verification.consensusResult).toBeTruthy();
    expect(verification.consensusResult!.acceptanceRatio).toBeCloseTo(2 / 3, 2);
  });

  it("proof verification: valid merkle tree → passes", async () => {
    const engine = new VerificationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // Build a provenance tree
    const treeBuilder = new MerkleTreeBuilder("contract-01", worker.did);
    const input = treeBuilder.addLeaf("input", "task input", "input");
    const step = treeBuilder.addLeaf("tool-call", { tool: "analyze" }, "step-1");
    const output = treeBuilder.addLeaf("output", "final result", "output");
    const tree = treeBuilder.build([input, step, output]);

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
    ], "proof");

    const contract = makeContract(requester, worker);
    const resultData = makeResult(worker, contract.id, "Good output");
    const result = { ...resultData, provenanceTree: tree, provenanceRootHash: tree.rootHash };

    const verification = await engine.verify(taskSpec, contract, result as ResultBundle);

    expect(verification.passed).toBe(true);
    expect(verification.qualityScore).toBe(1);
  });

  it("proof verification: tampered merkle tree → fails", async () => {
    const engine = new VerificationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // Build and tamper a provenance tree
    const treeBuilder = new MerkleTreeBuilder("contract-02", worker.did);
    const input = treeBuilder.addLeaf("input", "task input", "input");
    const tree = treeBuilder.build([input]);

    // Tamper: remove a node
    delete tree.nodes[input];

    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
    ], "proof");

    const contract = makeContract(requester, worker);
    const resultData = makeResult(worker, contract.id, "Output");
    const result = { ...resultData, provenanceTree: tree };

    const verification = await engine.verify(taskSpec, contract, result as ResultBundle);

    expect(verification.passed).toBe(false);
    expect(verification.qualityScore).toBe(0);
  });

  it("result fails automated checks → never reaches higher tiers", async () => {
    const adapter = new MockStakingAdapter();
    const optimisticVerifier = new OptimisticVerifier(adapter);
    const consensusVerifier = new ConsensusVerifier();

    // Register validators that should never be called
    let validatorCalled = false;
    consensusVerifier.registerValidator({
      did: generateAgentIdentity().did,
      domain: "test",
      reputation: 0.9,
      assess: async () => {
        validatorCalled = true;
        return { accepted: true, qualityScore: 1, reasoning: "Should not be called" };
      },
    });

    const engine = new VerificationEngine(optimisticVerifier, consensusVerifier);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // Task requires hash match (will fail)
    const taskSpec = makeTaskSpec(requester, [
      { type: "hash", expectedHash: "impossible-hash-value" },
    ], "consensus");

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const verification = await engine.verify(taskSpec, contract, result);

    expect(verification.passed).toBe(false);
    expect(verification.decidingTier).toBe("automated");
    expect(validatorCalled).toBe(false); // Validators never consulted
    expect(verification.consensusResult).toBeUndefined();
  });
});
