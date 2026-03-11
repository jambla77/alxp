import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../../src/identity/did.js";
import { signString } from "../../src/identity/signing.js";
import { ConsensusVerifier, type ValidatorAgent } from "../../src/verification/consensus.js";
import type { TaskSpec, TaskContract, ResultBundle } from "../../src/types/index.js";

function makeTaskSpec(
  requester: ReturnType<typeof generateAgentIdentity>,
  validators: number,
  threshold: number,
): TaskSpec {
  const id = ulid();
  return {
    id,
    requester: requester.did,
    created: new Date().toISOString(),
    objective: "Review this code",
    domain: "code-review",
    expectedOutput: { mimeType: "text/plain" },
    privacyClass: "public",
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria: [{ type: "consensus", validators, threshold }],
    verificationMethod: "consensus",
    tags: [],
    signature: signString(id, requester.keyPair.privateKey),
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
    agreedVerification: { method: "consensus" },
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
): ResultBundle {
  const id = ulid();
  return {
    id,
    contractId,
    worker: worker.did,
    submitted: new Date().toISOString(),
    outputs: [{ name: "output", mimeType: "text/plain", data: "The code looks good", encoding: "utf-8" }],
    provenance: {
      agentId: worker.did,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
    },
    signature: signString(id, worker.keyPair.privateKey),
  } as ResultBundle;
}

function makeValidator(
  accept: boolean,
  quality: number,
  domain = "code-review",
  reputation = 0.9,
): ValidatorAgent {
  const identity = generateAgentIdentity();
  return {
    did: identity.did,
    domain,
    reputation,
    assess: async () => ({
      accepted: accept,
      qualityScore: quality,
      reasoning: accept ? "Work meets criteria" : "Work does not meet criteria",
    }),
  };
}

describe("ConsensusVerifier (Tier 3)", () => {
  it("passes consensus when majority accepts", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(true, 0.9));
    verifier.registerValidator(makeValidator(true, 0.85));
    verifier.registerValidator(makeValidator(false, 0.3));

    const taskSpec = makeTaskSpec(requester, 3, 0.66); // 2 of 3 needed (2/3 ≈ 0.667 > 0.66)
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 3,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    expect(consensusResult.passed).toBe(true);
    expect(consensusResult.acceptanceRatio).toBeCloseTo(2 / 3, 2);
    expect(consensusResult.averageQuality).toBeGreaterThan(0.5);
    expect(consensusResult.assessments).toHaveLength(3);
  });

  it("fails consensus when majority rejects", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(false, 0.2));
    verifier.registerValidator(makeValidator(false, 0.3));
    verifier.registerValidator(makeValidator(true, 0.9));

    const taskSpec = makeTaskSpec(requester, 3, 0.67);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 3,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    expect(consensusResult.passed).toBe(false);
    expect(consensusResult.acceptanceRatio).toBeCloseTo(1 / 3, 2);
  });

  it("unanimous acceptance", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(true, 0.95));
    verifier.registerValidator(makeValidator(true, 0.9));
    verifier.registerValidator(makeValidator(true, 0.88));

    const taskSpec = makeTaskSpec(requester, 3, 0.67);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 3,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    expect(consensusResult.passed).toBe(true);
    expect(consensusResult.acceptanceRatio).toBe(1);
    expect(consensusResult.averageQuality).toBeGreaterThan(0.85);
  });

  it("excludes requester and worker from validators", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    // Register the worker as a validator — should be excluded
    verifier.registerValidator({
      did: worker.did,
      domain: "code-review",
      reputation: 0.99,
      assess: async () => ({ accepted: true, qualityScore: 1.0, reasoning: "I did it myself, it's great!" }),
    });
    // Register a real validator
    verifier.registerValidator(makeValidator(true, 0.8));

    const taskSpec = makeTaskSpec(requester, 1, 0.5);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 2,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    // Only 1 validator should have assessed (the real one, not the worker)
    expect(consensusResult.assessments).toHaveLength(1);
    expect(consensusResult.validators).not.toContain(worker.did);
  });

  it("filters by domain", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(true, 0.9, "code-review"));
    verifier.registerValidator(makeValidator(true, 0.9, "translation")); // Wrong domain

    const taskSpec = makeTaskSpec(requester, 2, 0.5);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 2,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    // Only 1 validator matches domain
    expect(consensusResult.assessments).toHaveLength(1);
  });

  it("filters by minimum reputation", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(true, 0.9, "code-review", 0.95));
    verifier.registerValidator(makeValidator(true, 0.9, "code-review", 0.3)); // Low reputation

    const taskSpec = makeTaskSpec(requester, 2, 0.5);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 2,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
      minReputation: 0.5,
    });

    // Only 1 validator meets reputation threshold
    expect(consensusResult.assessments).toHaveLength(1);
  });

  it("throws when no validators available", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    // No validators registered

    const taskSpec = makeTaskSpec(requester, 3, 0.67);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    await expect(
      verifier.verify(taskSpec, contract, result, {
        count: 3,
        excludeParties: [requester.did, worker.did],
        requiredDomain: "code-review",
      }),
    ).rejects.toThrow("No validators available");
  });

  it("computes average quality correctly", async () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const verifier = new ConsensusVerifier();
    verifier.registerValidator(makeValidator(true, 0.8));
    verifier.registerValidator(makeValidator(true, 0.6));

    const taskSpec = makeTaskSpec(requester, 2, 0.5);
    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const consensusResult = await verifier.verify(taskSpec, contract, result, {
      count: 2,
      excludeParties: [requester.did, worker.did],
      requiredDomain: "code-review",
    });

    expect(consensusResult.averageQuality).toBeCloseTo(0.7, 2);
  });
});
