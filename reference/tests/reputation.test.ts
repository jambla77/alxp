import { describe, it, expect } from "vitest";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import { ReputationEngine } from "../src/reputation/profile.js";
import { ulid } from "ulid";
import type { WorkReceipt } from "../src/types/receipt.js";

function makeReceipt(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  overrides?: Partial<WorkReceipt>,
): WorkReceipt {
  const id = ulid();
  return {
    id,
    contractId: ulid(),
    taskId: ulid(),
    requester: requester.did,
    worker: worker.did,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    qualityScore: 0.9,
    timelinessScore: 1.0,
    taskDomain: "code-review",
    taskComplexity: 0.5,
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
    ...overrides,
  } as WorkReceipt;
}

describe("ReputationEngine", () => {
  it("accepts and stores verified receipts", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const receipt = makeReceipt(requester, worker);
    expect(engine.addVerifiedReceipt(receipt)).toBe(true);
    expect(engine.size).toBe(1);
  });

  it("rejects receipts with invalid signatures", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const imposter = generateAgentIdentity();

    const id = ulid();
    const badReceipt: WorkReceipt = {
      id,
      contractId: ulid(),
      taskId: ulid(),
      requester: requester.did,
      worker: worker.did,
      status: "accepted",
      qualityScore: 0.9,
      timelinessScore: 1.0,
      taskDomain: "test",
      // Worker signature is from an imposter
      requesterSignature: signString(id, requester.keyPair.privateKey),
      workerSignature: signString(id, imposter.keyPair.privateKey),
    };

    expect(engine.addVerifiedReceipt(badReceipt)).toBe(false);
    expect(engine.size).toBe(0);
  });

  it("computes reputation profile from receipts", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // Add 5 accepted receipts with varying quality
    for (let i = 0; i < 5; i++) {
      engine.addReceipt(makeReceipt(requester, worker, {
        qualityScore: 0.7 + i * 0.05,
        timelinessScore: 0.9 + i * 0.02,
      }));
    }

    // Add 1 rejected receipt
    engine.addReceipt(makeReceipt(requester, worker, {
      status: "rejected",
      qualityScore: undefined,
    }));

    const profile = engine.getProfile(worker.did);

    expect(profile.agent).toBe(worker.did);
    expect(profile.totalTasksCompleted).toBe(5);
    expect(profile.receiptCount).toBe(6);
    expect(profile.acceptanceRate).toBeCloseTo(5 / 6, 2);
    expect(profile.disputeRate).toBe(0);
    expect(profile.avgQualityScore).toBeGreaterThan(0.7);
    expect(profile.avgTimelinessScore).toBeGreaterThan(0.9);
  });

  it("tracks domain-specific reputation", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    // 3 code-review tasks
    for (let i = 0; i < 3; i++) {
      engine.addReceipt(makeReceipt(requester, worker, {
        taskDomain: "code-review",
        qualityScore: 0.9,
      }));
    }

    // 2 translation tasks
    for (let i = 0; i < 2; i++) {
      engine.addReceipt(makeReceipt(requester, worker, {
        taskDomain: "translation",
        qualityScore: 0.8,
      }));
    }

    const profile = engine.getProfile(worker.did);

    expect(profile.domainScores.size).toBe(2);

    const codeReview = profile.domainScores.get("code-review")!;
    expect(codeReview.tasksCompleted).toBe(3);
    expect(codeReview.avgQuality).toBeCloseTo(0.9, 2);

    const translation = profile.domainScores.get("translation")!;
    expect(translation.tasksCompleted).toBe(2);
    expect(translation.avgQuality).toBeCloseTo(0.8, 2);
  });

  it("tracks requester activity", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker1 = generateAgentIdentity();
    const worker2 = generateAgentIdentity();

    engine.addReceipt(makeReceipt(requester, worker1));
    engine.addReceipt(makeReceipt(requester, worker2));

    const profile = engine.getProfile(requester.did);
    expect(profile.totalTasksPosted).toBe(2);
    // As a worker, this agent has done nothing
    expect(profile.totalTasksCompleted).toBe(0);
  });

  it("computes dispute rate", () => {
    const engine = new ReputationEngine();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    engine.addReceipt(makeReceipt(requester, worker, { status: "accepted" }));
    engine.addReceipt(makeReceipt(requester, worker, { status: "accepted" }));
    engine.addReceipt(makeReceipt(requester, worker, { status: "disputed" }));

    const profile = engine.getProfile(worker.did);
    expect(profile.disputeRate).toBeCloseTo(1 / 3, 2);
  });

  it("returns empty profile for unknown agent", () => {
    const engine = new ReputationEngine();
    const unknown = generateAgentIdentity();

    const profile = engine.getProfile(unknown.did);
    expect(profile.totalTasksCompleted).toBe(0);
    expect(profile.receiptCount).toBe(0);
    expect(profile.acceptanceRate).toBe(0);
  });
});
