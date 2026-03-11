import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { DisputeManager } from "../src/lifecycle/dispute.js";

describe("DisputeManager", () => {
  it("raises a dispute with initial evidence", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "quality-insufficient",
      description: "The result was completely unrelated to the task objective",
      evidence: "The output was lorem ipsum text",
    });

    expect(dm.status).toBe("open");
    expect(dm.record.reason).toBe("quality-insufficient");
    expect(dm.record.evidence).toHaveLength(1);
    expect(dm.record.evidence[0]!.submitter).toBe(worker.did);
    expect(dm.record.signatures).toHaveLength(1);
  });

  it("accepts evidence from both parties", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "quality-insufficient",
      description: "Output was wrong",
    });

    // Respondent submits counter-evidence
    dm.submitEvidence({
      submitter: requester.did,
      submitterKey: requester.keyPair,
      description: "The task spec was ambiguous, output matches a valid interpretation",
      data: "Here's the relevant part of the spec...",
    });

    expect(dm.record.evidence).toHaveLength(2);
    expect(dm.record.evidence[1]!.submitter).toBe(requester.did);
  });

  it("rejects evidence from third parties", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const stranger = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "other",
      description: "Dispute",
    });

    expect(() => {
      dm.submitEvidence({
        submitter: stranger.did,
        submitterKey: stranger.keyPair,
        description: "I have opinions too",
      });
    }).toThrow("Only the initiator or respondent");
  });

  it("follows the full dispute lifecycle: open -> arbitrating -> resolved", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const arbitrator = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "non-payment",
      description: "Requester accepted but did not release payment",
    });

    // Begin arbitration
    dm.beginArbitration(arbitrator.did);
    expect(dm.status).toBe("arbitrating");
    expect(dm.record.arbitrator).toBe(arbitrator.did);

    // Resolve
    const resolution = dm.resolve({
      arbitrator: arbitrator.did,
      arbitratorKey: arbitrator.keyPair,
      outcome: "worker-wins",
      description: "Evidence shows work was accepted. Payment should be released.",
      refundPercent: 0,
    });

    expect(dm.status).toBe("resolved");
    expect(resolution.outcome).toBe("worker-wins");
    expect(dm.record.resolved).toBeTruthy();
    expect(dm.isResolved()).toBe(true);
  });

  it("resolves directly without arbitration (parties agree)", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: requester.did,
      initiatorKey: requester.keyPair,
      respondent: worker.did,
      reason: "scope-mismatch",
      description: "Worker delivered something different from what was requested",
    });

    // Resolve with compromise
    const resolution = dm.resolve({
      arbitrator: requester.did,
      arbitratorKey: requester.keyPair,
      outcome: "compromise",
      description: "Parties agreed on 50% payment for partial work",
      refundPercent: 50,
    });

    expect(resolution.outcome).toBe("compromise");
    expect(resolution.refundPercent).toBe(50);
    expect(dm.isResolved()).toBe(true);
  });

  it("rejects wrong arbitrator resolving", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const arbitrator = generateAgentIdentity();
    const imposter = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "other",
      description: "Test",
    });

    dm.beginArbitration(arbitrator.did);

    expect(() => {
      dm.resolve({
        arbitrator: imposter.did,
        arbitratorKey: imposter.keyPair,
        outcome: "requester-wins",
        description: "I'm not the real arbitrator",
      });
    }).toThrow("Only the assigned arbitrator");
  });

  it("prevents evidence after resolution", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "other",
      description: "Test",
    });

    dm.resolve({
      arbitrator: requester.did,
      arbitratorKey: requester.keyPair,
      outcome: "requester-wins",
      description: "Resolved",
    });

    expect(() => {
      dm.submitEvidence({
        submitter: worker.did,
        submitterKey: worker.keyPair,
        description: "But wait, there's more!",
      });
    }).toThrow("resolved dispute");
  });

  it("prevents double arbitration start", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const arb = generateAgentIdentity();

    const dm = new DisputeManager({
      contractId: ulid(),
      initiator: worker.did,
      initiatorKey: worker.keyPair,
      respondent: requester.did,
      reason: "other",
      description: "Test",
    });

    dm.beginArbitration(arb.did);

    expect(() => dm.beginArbitration(arb.did)).toThrow("dispute is arbitrating");
  });
});
