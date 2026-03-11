/**
 * Integration test: Full exchange lifecycle
 *
 * register → heartbeat → discover → bid → award → work (with metering) →
 * submit → accept → earn credits → spend credits on another task
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../../src/identity/did.js";
import { signString } from "../../src/identity/signing.js";
import { generateAgentCard, matchesQuery, checkBidEligibility, calculateCreditCost } from "../../src/discovery/agent-card.js";
import { AgentRegistry } from "../../src/discovery/registry.js";
import { HeartbeatTracker, hasRemainingQuota } from "../../src/discovery/heartbeat.js";
import { CreditLedger } from "../../src/settlement/credit-ledger.js";
import { CreditSettlementAdapter } from "../../src/settlement/credit-adapter.js";
import { MeteringTracker, validateMeteringReport, QuotaConsumptionTracker } from "../../src/metering/tracker.js";
import type { TaskContract } from "../../src/types/contract.js";
import type { WorkReceipt } from "../../src/types/receipt.js";
import type { Heartbeat } from "../../src/types/message.js";

function makeContract(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  amount: number,
  taskId: string,
): TaskContract {
  const id = ulid();
  return {
    id,
    taskId,
    offerId: ulid(),
    requester: requester.did,
    worker: worker.did,
    agreedPrice: { amount, currency: "credits", model: "fixed" },
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

function makeReceipt(
  contractId: string,
  taskId: string,
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  effortTier: string,
): WorkReceipt {
  const id = ulid();
  return {
    id,
    contractId,
    taskId,
    requester: requester.did,
    worker: worker.did,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    qualityScore: 0.9,
    timelinessScore: 1.0,
    taskDomain: "code-generation",
    effortTier,
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
  } as WorkReceipt;
}

describe("Exchange lifecycle integration", () => {
  it("full flow: register → heartbeat → discover → bid → work → earn → spend", async () => {
    // ── Setup shared infrastructure ──
    const registry = new AgentRegistry();
    const heartbeats = new HeartbeatTracker({ staleTimeout: 60000 });
    const ledger = new CreditLedger();
    const settlement = new CreditSettlementAdapter(ledger);
    const metering = new MeteringTracker();
    const quotaTracker = new QuotaConsumptionTracker();

    // ── Create 3 agents ──
    const alice = generateAgentIdentity(); // Requester with purchased credits
    const bob = generateAgentIdentity();   // Worker (medium tier)
    const carol = generateAgentIdentity(); // Worker (high tier), Bob will hire later

    // ── 1. Register agents with capability tiers ──
    const bobCard = generateAgentCard({
      identity: bob,
      capabilities: [{ domain: "code-generation", subDomain: "typescript", confidenceLevel: 0.85, tags: ["typescript", "node"] }],
      trustTier: "open-internet",
      endpoint: `https://${bob.did}/alxp`,
      capabilityTier: "medium",
      effortHistory: [
        { tier: "low", tasksCompleted: 30, successRate: 0.93, avgQualityScore: 0.88 },
        { tier: "medium", tasksCompleted: 15, successRate: 0.87, avgQualityScore: 0.85 },
      ],
      availability: {
        status: "online",
        capacity: 0.8,
        quotas: { maxTokensPerDay: 5000000, maxConcurrentTasks: 3 },
      },
      costModel: { basePrice: { amount: 500, currency: "credits", model: "fixed" }, currency: "credits" },
    });

    const carolCard = generateAgentCard({
      identity: carol,
      capabilities: [{ domain: "code-generation", subDomain: "fullstack", confidenceLevel: 0.95, tags: ["typescript", "react", "postgres"] }],
      trustTier: "open-internet",
      endpoint: `https://${carol.did}/alxp`,
      capabilityTier: "high",
      effortHistory: [
        { tier: "high", tasksCompleted: 25, successRate: 0.92, avgQualityScore: 0.9 },
      ],
      availability: { status: "online", capacity: 0.9 },
      costModel: { basePrice: { amount: 1000, currency: "credits", model: "fixed" }, currency: "credits" },
    });

    registry.register(bobCard);
    registry.register(carolCard);
    expect(registry.size).toBe(2);

    // ── 2. Agents send heartbeats ──
    const bobHeartbeat: Heartbeat = {
      type: "HEARTBEAT",
      agentId: bob.did,
      status: "online",
      capacity: 0.8,
      currentTasks: 0,
      quotaRemaining: { tokensThisHour: 500000, tokensThisDay: 4500000, tasksThisDay: 47 },
    };

    const carolHeartbeat: Heartbeat = {
      type: "HEARTBEAT",
      agentId: carol.did,
      status: "online",
      capacity: 0.9,
      currentTasks: 1,
    };

    heartbeats.recordHeartbeat(bobHeartbeat);
    heartbeats.recordHeartbeat(carolHeartbeat);

    expect(heartbeats.isAlive(bob.did)).toBe(true);
    expect(heartbeats.isAlive(carol.did)).toBe(true);
    expect(heartbeats.getAliveAgents()).toHaveLength(2);

    // ── 3. Alice purchases credits ──
    ledger.purchase(alice.did, 5000, "Initial credit purchase");
    expect(ledger.getBalance(alice.did).available).toBe(5000);

    // ── 4. Alice discovers agents for a medium-effort task ──
    const taskEffort = "medium" as const;
    const taskCreditCost = calculateCreditCost(taskEffort); // 500 credits

    const candidates = registry.query({
      domain: "code-generation",
      effortTier: taskEffort,
      onlineOnly: true,
    });

    // Both Bob (medium) and Carol (high) can handle medium tasks
    expect(candidates).toHaveLength(2);

    // ── 5. Check bid eligibility ──
    const bobEligibility = checkBidEligibility(bobCard, taskEffort);
    expect(bobEligibility.eligible).toBe(true);

    // Verify Bob has remaining quota
    const bobHbState = heartbeats.getState(bob.did)!;
    expect(hasRemainingQuota(bobHbState)).toBe(true);

    // ── 6. Alice awards task to Bob ──
    const taskId = ulid();
    const contract = makeContract(alice, bob, taskCreditCost, taskId);
    const escrow = await settlement.createEscrow(contract);

    expect(escrow.status).toBe("held");
    expect(ledger.getBalance(alice.did).available).toBe(4500);
    expect(ledger.getBalance(alice.did).escrowed).toBe(500);

    // ── 7. Bob starts working — metering begins ──
    metering.startSession(contract.id, taskId, bob.did);
    quotaTracker.recordTask(bob.did);

    // Simulate work steps
    metering.recordUsage(contract.id, { inputTokens: 10000, outputTokens: 5000, wallClockMs: 15000, toolCalls: 2 });
    metering.recordUsage(contract.id, { inputTokens: 8000, outputTokens: 4000, wallClockMs: 12000, toolCalls: 1 });

    // Bob sends an interim metering update
    const interimReport = metering.generateReport(contract.id, (c) => ({
      creditsConsumed: Math.round((c.inputTokens * 0.003 + c.outputTokens * 0.015)),
      breakdown: [
        { category: "input", amount: c.inputTokens * 0.003 },
        { category: "output", amount: c.outputTokens * 0.015 },
      ],
    }));

    expect(interimReport.usage.totalTokens).toBe(27000);
    expect(interimReport.usage.toolCalls).toBe(3);

    // Validate the report
    const validation = validateMeteringReport(interimReport, {
      maxTokens: 500000,
      maxDurationMs: 600000,
    });
    expect(validation.valid).toBe(true);

    // More work
    metering.recordUsage(contract.id, { inputTokens: 5000, outputTokens: 3000, wallClockMs: 8000 });

    // ── 8. Bob finalizes and submits ──
    const finalReport = metering.finalize(contract.id, (c) => ({
      creditsConsumed: Math.round((c.inputTokens * 0.003 + c.outputTokens * 0.015)),
    }));

    expect(finalReport.usage.totalTokens).toBe(35000);
    expect(metering.isActive(contract.id)).toBe(false);

    // Record token consumption against Bob's quota
    quotaTracker.recordTokens(bob.did, finalReport.usage.totalTokens);

    // ── 9. Alice accepts the result — credits flow to Bob ──
    const receipt = makeReceipt(contract.id, taskId, alice, bob, taskEffort);
    const proof = await settlement.releaseEscrow(escrow.id, receipt);

    expect(proof.action).toBe("release");
    expect(proof.amount.amount).toBe(500);

    // Bob now has 500 credits earned
    const bobBalance = ledger.getBalance(bob.did);
    expect(bobBalance.available).toBe(500);
    expect(bobBalance.earned).toBe(500);

    // Alice spent 500, has 4500 remaining
    const aliceBalance = ledger.getBalance(alice.did);
    expect(aliceBalance.available).toBe(4500);
    expect(aliceBalance.spent).toBe(500);
    expect(aliceBalance.escrowed).toBe(0);

    // ── 10. Bob spends earned credits on a high-effort task from Carol ──
    const task2Effort = "high" as const;
    const task2Id = ulid();

    // Discover high-tier agents
    const highCandidates = registry.query({
      domain: "code-generation",
      effortTier: task2Effort,
      onlineOnly: true,
    });

    // Only Carol can handle high-effort tasks
    expect(highCandidates).toHaveLength(1);
    expect(highCandidates[0]!.id).toBe(carol.did);

    // Bob awards task to Carol for 400 credits (within his 500 balance)
    const contract2 = makeContract(bob, carol, 400, task2Id);
    const escrow2 = await settlement.createEscrow(contract2);

    expect(ledger.getBalance(bob.did).available).toBe(100);
    expect(ledger.getBalance(bob.did).escrowed).toBe(400);

    // Carol completes and Bob accepts
    const receipt2 = makeReceipt(contract2.id, task2Id, bob, carol, task2Effort);
    await settlement.releaseEscrow(escrow2.id, receipt2);

    // Final balances
    const bobFinal = ledger.getBalance(bob.did);
    expect(bobFinal.available).toBe(100);
    expect(bobFinal.earned).toBe(500);
    expect(bobFinal.spent).toBe(400);

    const carolFinal = ledger.getBalance(carol.did);
    expect(carolFinal.available).toBe(400);
    expect(carolFinal.earned).toBe(400);

    // ── 11. Verify complete audit trail ──
    const allTxs = ledger.getTransactions();
    expect(allTxs.length).toBeGreaterThanOrEqual(6);
    // Alice: purchase, escrow, release(spend) = 3
    // Bob: earn, escrow, release(spend) = 3
    // Carol: earn = 1
    // Total = 7 minimum

    const aliceTxs = ledger.getTransactions(alice.did);
    expect(aliceTxs.map(t => t.type)).toEqual(["purchase", "escrow", "release"]);

    const bobTxs = ledger.getTransactions(bob.did);
    expect(bobTxs.map(t => t.type)).toEqual(["earn", "escrow", "release"]);

    const carolTxs = ledger.getTransactions(carol.did);
    expect(carolTxs.map(t => t.type)).toEqual(["earn"]);

    // ── 12. Verify quota tracking ──
    const quotaCheck = quotaTracker.checkQuota(bob.did, { maxTokensPerDay: 5000000, maxTasksPerDay: 50 });
    expect(quotaCheck.allowed).toBe(true);
    expect(quotaCheck.remaining.tokensThisDay).toBe(5000000 - 35000);

    // ── 13. Verify all settlement proofs ──
    const proofs = settlement.getProofs();
    expect(proofs).toHaveLength(2);
    expect(proofs.every(p => p.action === "release")).toBe(true);
  });

  it("effort tier filtering prevents under-qualified agents from bidding", () => {
    const registry = new AgentRegistry();

    const lowAgent = generateAgentIdentity();
    const lowCard = generateAgentCard({
      identity: lowAgent,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: `https://${lowAgent.did}/alxp`,
      capabilityTier: "low",
    });

    registry.register(lowCard);

    // Low agent can't handle high tasks
    const highResults = registry.query({ domain: "code-generation", effortTier: "high" });
    expect(highResults).toHaveLength(0);

    // But can handle low tasks
    const lowResults = registry.query({ domain: "code-generation", effortTier: "low" });
    expect(lowResults).toHaveLength(1);
  });

  it("agent at capacity rejects new tasks via quota check", () => {
    const quotaTracker = new QuotaConsumptionTracker();
    const now = new Date("2026-03-11T14:00:00Z");

    // Agent has a limit of 3 tasks per hour
    for (let i = 0; i < 3; i++) {
      quotaTracker.recordTask("did:key:z6MkBusy", now);
    }

    const check = quotaTracker.checkQuota("did:key:z6MkBusy", { maxTasksPerHour: 3 }, now);
    expect(check.allowed).toBe(false);
    expect(check.violations[0]).toContain("Hourly task limit");
    expect(check.remaining.tasksThisHour).toBe(0);
  });

  it("refund flow: task cancelled, credits returned", async () => {
    const ledger = new CreditLedger();
    const settlement = new CreditSettlementAdapter(ledger);

    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    ledger.purchase(requester.did, 1000);

    const contract = makeContract(requester, worker, 500, ulid());
    const escrow = await settlement.createEscrow(contract);

    expect(ledger.getBalance(requester.did).available).toBe(500);
    expect(ledger.getBalance(requester.did).escrowed).toBe(500);

    // Task gets cancelled
    await settlement.refundEscrow(escrow.id, "Worker went offline");

    // Credits fully returned
    expect(ledger.getBalance(requester.did).available).toBe(1000);
    expect(ledger.getBalance(requester.did).escrowed).toBe(0);
    expect(ledger.getBalance(worker.did).available).toBe(0);
  });
});
