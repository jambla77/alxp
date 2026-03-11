import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import { MockSettlementAdapter } from "../src/settlement/adapter.js";
import type { TaskContract } from "../src/types/contract.js";
import type { WorkReceipt } from "../src/types/receipt.js";

function makeContract(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  amount = 1.00,
): TaskContract {
  const id = ulid();
  return {
    id,
    taskId: ulid(),
    offerId: ulid(),
    requester: requester.did,
    worker: worker.did,
    agreedPrice: { amount, currency: "USD", model: "fixed" },
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "schema-check" },
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

function makeReceipt(
  contractId: string,
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
): WorkReceipt {
  const id = ulid();
  return {
    id,
    contractId,
    taskId: ulid(),
    requester: requester.did,
    worker: worker.did,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    qualityScore: 0.9,
    timelinessScore: 1.0,
    taskDomain: "test",
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
  } as WorkReceipt;
}

describe("MockSettlementAdapter", () => {
  it("creates and releases escrow", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 10.00);

    const contract = makeContract(requester, worker, 1.00);
    const escrow = await adapter.createEscrow(contract);

    expect(escrow.status).toBe("held");
    expect(escrow.amount.amount).toBe(1.00);
    expect(adapter.balances.get(requester.did)).toBe(9.00);

    const receipt = makeReceipt(contract.id, requester, worker);
    const proof = await adapter.releaseEscrow(escrow.id, receipt);

    expect(proof.action).toBe("release");
    expect(proof.amount.amount).toBe(1.00);
    expect(adapter.balances.get(worker.did)).toBe(1.00);

    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("released");
  });

  it("refunds escrow on cancellation", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 5.00);

    const contract = makeContract(requester, worker, 2.00);
    const escrow = await adapter.createEscrow(contract);
    expect(adapter.balances.get(requester.did)).toBe(3.00);

    const proof = await adapter.refundEscrow(escrow.id, "Task cancelled");
    expect(proof.action).toBe("refund");
    expect(proof.metadata?.reason).toBe("Task cancelled");

    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("refunded");
  });

  it("handles partial release (dispute compromise)", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 10.00);

    const contract = makeContract(requester, worker, 5.00);
    const escrow = await adapter.createEscrow(contract);

    const receipt = makeReceipt(contract.id, requester, worker);
    const proof = await adapter.partialRelease(
      escrow.id,
      { amount: 2.50, currency: "USD", model: "fixed" },
      receipt,
    );

    expect(proof.action).toBe("partial-release");
    expect(proof.amount.amount).toBe(2.50);
    expect(adapter.balances.get(worker.did)).toBe(2.50);

    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("partial");
  });

  it("rejects escrow with insufficient balance", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 0.50);

    const contract = makeContract(requester, worker, 1.00);
    await expect(adapter.createEscrow(contract)).rejects.toThrow("Insufficient balance");
  });

  it("rejects double-release", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 5.00);

    const contract = makeContract(requester, worker, 1.00);
    const escrow = await adapter.createEscrow(contract);

    const receipt = makeReceipt(contract.id, requester, worker);
    await adapter.releaseEscrow(escrow.id, receipt);

    // Try to release again
    await expect(adapter.releaseEscrow(escrow.id, receipt)).rejects.toThrow("not held");
  });

  it("rejects partial release exceeding escrow", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 10.00);

    const contract = makeContract(requester, worker, 3.00);
    const escrow = await adapter.createEscrow(contract);

    const receipt = makeReceipt(contract.id, requester, worker);
    await expect(
      adapter.partialRelease(escrow.id, { amount: 5.00, currency: "USD", model: "fixed" }, receipt),
    ).rejects.toThrow("exceeds escrow");
  });

  it("tracks settlement proofs for auditing", async () => {
    const adapter = new MockSettlementAdapter();
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(requester.did, 10.00);

    const contract = makeContract(requester, worker, 1.00);
    const escrow = await adapter.createEscrow(contract);
    const receipt = makeReceipt(contract.id, requester, worker);
    await adapter.releaseEscrow(escrow.id, receipt);

    const proofs = adapter.getProofs();
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.action).toBe("release");
  });
});
