import { describe, it, expect, beforeEach } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import { CreditLedger } from "../src/settlement/credit-ledger.js";
import { CreditSettlementAdapter } from "../src/settlement/credit-adapter.js";
import type { TaskContract } from "../src/types/contract.js";
import type { WorkReceipt } from "../src/types/receipt.js";

function makeContract(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  amount: number,
  currency = "credits",
): TaskContract {
  const id = ulid();
  return {
    id,
    taskId: ulid(),
    offerId: ulid(),
    requester: requester.did,
    worker: worker.did,
    agreedPrice: { amount, currency, model: "fixed" },
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
    effortTier: "medium",
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
  } as WorkReceipt;
}

// ── CreditLedger Tests ──

describe("CreditLedger", () => {
  let ledger: CreditLedger;

  beforeEach(() => {
    ledger = new CreditLedger();
  });

  it("starts with zero balance", () => {
    const bal = ledger.getBalance("did:key:z6MkNew");
    expect(bal.available).toBe(0);
    expect(bal.escrowed).toBe(0);
    expect(bal.earned).toBe(0);
    expect(bal.spent).toBe(0);
    expect(bal.purchased).toBe(0);
  });

  it("purchase adds to available and purchased", () => {
    const tx = ledger.purchase("did:key:z6MkAgent", 1000, "Initial purchase");
    expect(tx.type).toBe("purchase");
    expect(tx.amount).toBe(1000);

    const bal = ledger.getBalance("did:key:z6MkAgent");
    expect(bal.available).toBe(1000);
    expect(bal.purchased).toBe(1000);
  });

  it("grant adds to available", () => {
    ledger.grant("did:key:z6MkAgent", 500, "Sign-up bonus");
    const bal = ledger.getBalance("did:key:z6MkAgent");
    expect(bal.available).toBe(500);
    expect(bal.purchased).toBe(0);
  });

  it("escrow moves credits from available to escrowed", () => {
    ledger.purchase("did:key:z6MkAgent", 1000);
    ledger.escrow("did:key:z6MkAgent", 400);

    const bal = ledger.getBalance("did:key:z6MkAgent");
    expect(bal.available).toBe(600);
    expect(bal.escrowed).toBe(400);
  });

  it("escrow rejects insufficient balance", () => {
    ledger.purchase("did:key:z6MkAgent", 100);
    expect(() => ledger.escrow("did:key:z6MkAgent", 200)).toThrow("Insufficient credits");
  });

  it("release transfers from requester escrowed to worker available", () => {
    const requester = "did:key:z6MkRequester";
    const worker = "did:key:z6MkWorker";

    ledger.purchase(requester, 1000);
    ledger.escrow(requester, 500);

    const { requesterTx, workerTx } = ledger.release(requester, worker, 500);

    expect(requesterTx.type).toBe("release");
    expect(workerTx.type).toBe("earn");

    const reqBal = ledger.getBalance(requester);
    expect(reqBal.available).toBe(500);
    expect(reqBal.escrowed).toBe(0);
    expect(reqBal.spent).toBe(500);

    const workerBal = ledger.getBalance(worker);
    expect(workerBal.available).toBe(500);
    expect(workerBal.earned).toBe(500);
  });

  it("release rejects insufficient escrowed balance", () => {
    ledger.purchase("did:key:z6MkReq", 1000);
    ledger.escrow("did:key:z6MkReq", 200);
    expect(() => ledger.release("did:key:z6MkReq", "did:key:z6MkW", 300)).toThrow(
      "Insufficient escrowed",
    );
  });

  it("refund moves credits from escrowed back to available", () => {
    const agent = "did:key:z6MkAgent";
    ledger.purchase(agent, 1000);
    ledger.escrow(agent, 400);
    ledger.refund(agent, 400);

    const bal = ledger.getBalance(agent);
    expect(bal.available).toBe(1000);
    expect(bal.escrowed).toBe(0);
  });

  it("slash deducts from available", () => {
    const agent = "did:key:z6MkBad";
    ledger.purchase(agent, 1000);
    ledger.slash(agent, 300, "Failed spot check");

    const bal = ledger.getBalance(agent);
    expect(bal.available).toBe(700);
  });

  it("slash does not go below zero", () => {
    const agent = "did:key:z6MkBad";
    ledger.purchase(agent, 100);
    ledger.slash(agent, 500, "Big penalty");

    const bal = ledger.getBalance(agent);
    expect(bal.available).toBe(0);
  });

  it("tracks full transaction history", () => {
    const agent = "did:key:z6MkAgent";
    ledger.purchase(agent, 1000);
    ledger.grant(agent, 200);
    ledger.escrow(agent, 500);

    const txs = ledger.getTransactions(agent);
    expect(txs).toHaveLength(3);
    expect(txs.map((t) => t.type)).toEqual(["purchase", "grant", "escrow"]);
  });

  it("filters transactions by type", () => {
    const agent = "did:key:z6MkAgent";
    ledger.purchase(agent, 500);
    ledger.grant(agent, 200);
    ledger.purchase(agent, 300);

    const purchases = ledger.getTransactions(agent, "purchase");
    expect(purchases).toHaveLength(2);
  });

  it("rejects non-positive amounts", () => {
    expect(() => ledger.purchase("did:key:z6Mk", 0)).toThrow("must be positive");
    expect(() => ledger.purchase("did:key:z6Mk", -1)).toThrow("must be positive");
    expect(() => ledger.grant("did:key:z6Mk", 0)).toThrow("must be positive");
    expect(() => ledger.escrow("did:key:z6Mk", 0)).toThrow("must be positive");
    expect(() => ledger.slash("did:key:z6Mk", 0)).toThrow("must be positive");
  });
});

// ── CreditSettlementAdapter Tests ──

describe("CreditSettlementAdapter", () => {
  let adapter: CreditSettlementAdapter;
  let requester: ReturnType<typeof generateAgentIdentity>;
  let worker: ReturnType<typeof generateAgentIdentity>;

  beforeEach(() => {
    adapter = new CreditSettlementAdapter();
    requester = generateAgentIdentity();
    worker = generateAgentIdentity();
  });

  it("creates and releases escrow with credits", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 500);
    const escrow = await adapter.createEscrow(contract);

    expect(escrow.status).toBe("held");
    expect(escrow.adapter).toBe("credit-ledger");
    expect(escrow.amount.currency).toBe("credits");

    // Requester credits escrowed
    const reqBal = adapter.ledger.getBalance(requester.did);
    expect(reqBal.available).toBe(500);
    expect(reqBal.escrowed).toBe(500);

    // Release to worker
    const receipt = makeReceipt(contract.id, requester, worker);
    const proof = await adapter.releaseEscrow(escrow.id, receipt);

    expect(proof.action).toBe("release");
    expect(proof.amount.amount).toBe(500);

    // Worker got credits
    const workerBal = adapter.ledger.getBalance(worker.did);
    expect(workerBal.available).toBe(500);
    expect(workerBal.earned).toBe(500);

    // Requester escrow cleared, spent tracked
    const reqBal2 = adapter.ledger.getBalance(requester.did);
    expect(reqBal2.escrowed).toBe(0);
    expect(reqBal2.spent).toBe(500);

    // Escrow status updated
    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("released");
  });

  it("refunds escrow back to requester", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 300);
    const escrow = await adapter.createEscrow(contract);

    expect(adapter.ledger.getBalance(requester.did).available).toBe(700);

    const proof = await adapter.refundEscrow(escrow.id, "Task cancelled");
    expect(proof.action).toBe("refund");
    expect(proof.metadata?.reason).toBe("Task cancelled");

    // Credits returned to requester
    const bal = adapter.ledger.getBalance(requester.did);
    expect(bal.available).toBe(1000);
    expect(bal.escrowed).toBe(0);

    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("refunded");
  });

  it("handles partial release (dispute compromise)", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 600);
    const escrow = await adapter.createEscrow(contract);

    const receipt = makeReceipt(contract.id, requester, worker);
    const proof = await adapter.partialRelease(
      escrow.id,
      { amount: 400, currency: "credits", model: "fixed" },
      receipt,
    );

    expect(proof.action).toBe("partial-release");
    expect(proof.amount.amount).toBe(400);
    expect(proof.metadata?.refundedAmount).toBe(200);

    // Worker got 400
    expect(adapter.ledger.getBalance(worker.did).available).toBe(400);

    // Requester got 200 back (600 escrowed - 400 to worker = 200 refund)
    const reqBal = adapter.ledger.getBalance(requester.did);
    expect(reqBal.available).toBe(600); // 400 remaining + 200 refunded
    expect(reqBal.escrowed).toBe(0);

    const updated = await adapter.getEscrow(escrow.id);
    expect(updated!.status).toBe("partial");
  });

  it("rejects insufficient credits", async () => {
    adapter.ledger.purchase(requester.did, 100);

    const contract = makeContract(requester, worker, 500);
    await expect(adapter.createEscrow(contract)).rejects.toThrow("Insufficient credits");
  });

  it("rejects non-credits currency", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 100, "USD");
    await expect(adapter.createEscrow(contract)).rejects.toThrow('only supports currency "credits"');
  });

  it("rejects double-release", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 200);
    const escrow = await adapter.createEscrow(contract);
    const receipt = makeReceipt(contract.id, requester, worker);

    await adapter.releaseEscrow(escrow.id, receipt);
    await expect(adapter.releaseEscrow(escrow.id, receipt)).rejects.toThrow("not held");
  });

  it("rejects partial release exceeding escrow", async () => {
    adapter.ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 300);
    const escrow = await adapter.createEscrow(contract);
    const receipt = makeReceipt(contract.id, requester, worker);

    await expect(
      adapter.partialRelease(
        escrow.id,
        { amount: 500, currency: "credits", model: "fixed" },
        receipt,
      ),
    ).rejects.toThrow("exceeds escrow");
  });

  it("tracks settlement proofs", async () => {
    adapter.ledger.purchase(requester.did, 2000);

    const contract = makeContract(requester, worker, 500);
    const escrow = await adapter.createEscrow(contract);
    const receipt = makeReceipt(contract.id, requester, worker);
    await adapter.releaseEscrow(escrow.id, receipt);

    const proofs = adapter.getProofs();
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.action).toBe("release");
  });

  it("supports earn-then-spend flow (worker earns, then spends as requester)", async () => {
    // Requester A funds and creates a task for Worker B
    const agentA = generateAgentIdentity();
    const agentB = generateAgentIdentity();
    const agentC = generateAgentIdentity();

    adapter.ledger.purchase(agentA.did, 1000);

    // A → B: task worth 500 credits
    const contract1 = makeContract(agentA, agentB, 500);
    const escrow1 = await adapter.createEscrow(contract1);
    const receipt1 = makeReceipt(contract1.id, agentA, agentB);
    await adapter.releaseEscrow(escrow1.id, receipt1);

    // B now has 500 credits earned
    expect(adapter.ledger.getBalance(agentB.did).available).toBe(500);
    expect(adapter.ledger.getBalance(agentB.did).earned).toBe(500);

    // B → C: B spends earned credits on a task from C
    const contract2 = makeContract(agentB, agentC, 300);
    const escrow2 = await adapter.createEscrow(contract2);
    const receipt2 = makeReceipt(contract2.id, agentB, agentC);
    await adapter.releaseEscrow(escrow2.id, receipt2);

    // B spent 300 of 500
    const bBal = adapter.ledger.getBalance(agentB.did);
    expect(bBal.available).toBe(200);
    expect(bBal.spent).toBe(300);
    expect(bBal.earned).toBe(500);

    // C earned 300
    const cBal = adapter.ledger.getBalance(agentC.did);
    expect(cBal.available).toBe(300);
    expect(cBal.earned).toBe(300);

    // Full transaction audit trail
    const allTxs = adapter.ledger.getTransactions();
    expect(allTxs.length).toBeGreaterThanOrEqual(5);
  });

  it("works with a shared ledger instance", async () => {
    const ledger = new CreditLedger();
    const adapter1 = new CreditSettlementAdapter(ledger);
    const adapter2 = new CreditSettlementAdapter(ledger);

    ledger.purchase(requester.did, 1000);

    // Use adapter1 to escrow
    const contract = makeContract(requester, worker, 200);
    const escrow = await adapter1.createEscrow(contract);

    // Balance visible from both adapters (same ledger)
    expect(adapter2.ledger.getBalance(requester.did).available).toBe(800);
    expect(adapter2.ledger.getBalance(requester.did).escrowed).toBe(200);
  });
});
