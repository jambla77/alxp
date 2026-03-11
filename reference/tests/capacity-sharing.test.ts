/**
 * Tests for the capacity sharing model:
 * CapacitySource validation, donation flow, billing cycle awareness,
 * provider-aware pricing, and capacity-based discovery filtering.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import {
  CapacitySource,
  CapacitySnapshot,
  SubscriptionProvider,
  SubscriptionTier,
  CreditBalance,
  CreditTransactionType,
  QuotaRemaining,
} from "../src/types/exchange.js";
import { CreditLedger } from "../src/settlement/credit-ledger.js";
import { CreditSettlementAdapter } from "../src/settlement/credit-adapter.js";
import {
  generateAgentCard,
  matchesQuery,
  calculateCreditCost,
  PROVIDER_TIER_MULTIPLIERS,
} from "../src/discovery/agent-card.js";
import {
  HeartbeatTracker,
  hasRemainingCapacity,
} from "../src/discovery/heartbeat.js";
import { AgentRegistry } from "../src/discovery/registry.js";
import type { Heartbeat } from "../src/types/message.js";
import type { TaskContract } from "../src/types/contract.js";
import type { WorkReceipt } from "../src/types/receipt.js";

// ── CapacitySource Validation ──

describe("CapacitySource schema", () => {
  it("parses a Claude Max subscription", () => {
    const src = CapacitySource.parse({
      provider: "anthropic",
      tier: "max",
      planName: "Claude Max",
      capacityType: "messages",
      billingCycle: {
        renewsAt: "2026-04-01T00:00:00.000Z",
        periodDays: 30,
      },
      totalCapacity: 1000,
      sharedCapacity: 500,
      reservedForOwner: 500,
      modelAccess: ["claude-sonnet-4", "claude-opus-4"],
      verified: false,
    });
    expect(src.provider).toBe("anthropic");
    expect(src.tier).toBe("max");
    expect(src.sharedCapacity).toBe(500);
    expect(src.modelAccess).toContain("claude-opus-4");
  });

  it("parses a local GPU setup", () => {
    const src = CapacitySource.parse({
      provider: "local",
      tier: "local-gpu",
      capacityType: "unlimited-local",
      modelAccess: ["llama-3.1-70b"],
    });
    expect(src.provider).toBe("local");
    expect(src.capacityType).toBe("unlimited-local");
  });

  it("parses an OpenAI Plus subscription", () => {
    const src = CapacitySource.parse({
      provider: "openai",
      tier: "pro",
      planName: "ChatGPT Plus",
      capacityType: "messages",
    });
    expect(src.provider).toBe("openai");
    expect(src.tier).toBe("pro");
  });

  it("rejects unknown provider", () => {
    expect(() =>
      CapacitySource.parse({
        provider: "unknown-co",
        tier: "pro",
        capacityType: "tokens",
      }),
    ).toThrow();
  });

  it("rejects unknown capacity type", () => {
    expect(() =>
      CapacitySource.parse({
        provider: "anthropic",
        tier: "pro",
        capacityType: "credits",
      }),
    ).toThrow();
  });
});

// ── CapacitySnapshot ──

describe("CapacitySnapshot schema", () => {
  it("parses a full snapshot", () => {
    const snap = CapacitySnapshot.parse({
      remainingInPeriod: 800,
      remainingShared: 400,
      renewsAt: "2026-04-01T00:00:00.000Z",
      utilizationRate: 0.2,
    });
    expect(snap.remainingShared).toBe(400);
    expect(snap.utilizationRate).toBe(0.2);
  });

  it("accepts empty snapshot (all optional)", () => {
    const snap = CapacitySnapshot.parse({});
    expect(snap.remainingInPeriod).toBeUndefined();
  });

  it("rejects utilization rate > 1", () => {
    expect(() =>
      CapacitySnapshot.parse({ utilizationRate: 1.5 }),
    ).toThrow();
  });
});

// ── SubscriptionProvider / SubscriptionTier ──

describe("SubscriptionProvider", () => {
  it("accepts all valid providers", () => {
    for (const p of ["anthropic", "openai", "google", "xai", "local", "other"]) {
      expect(SubscriptionProvider.parse(p)).toBe(p);
    }
  });
});

describe("SubscriptionTier", () => {
  it("accepts all valid tiers", () => {
    for (const t of ["free", "pro", "max", "team", "enterprise", "local-gpu", "other"]) {
      expect(SubscriptionTier.parse(t)).toBe(t);
    }
  });
});

// ── CreditBalance with new fields ──

describe("CreditBalance with capacity fields", () => {
  it("includes bootstrapped, donated, consumed", () => {
    const bal = CreditBalance.parse({
      agentId: "did:key:z6MkTest",
      available: 1500,
      escrowed: 0,
      earned: 1000,
      spent: 200,
      bootstrapped: 500,
      donated: 200,
      consumed: 100,
      lastUpdated: "2026-03-11T14:30:00.000Z",
    });
    expect(bal.bootstrapped).toBe(500);
    expect(bal.donated).toBe(200);
    expect(bal.consumed).toBe(100);
  });
});

// ── CreditTransactionType ──

describe("CreditTransactionType new types", () => {
  it("accepts bootstrap and donate", () => {
    expect(CreditTransactionType.parse("bootstrap")).toBe("bootstrap");
    expect(CreditTransactionType.parse("donate")).toBe("donate");
  });

  it("rejects purchase (removed)", () => {
    expect(() => CreditTransactionType.parse("purchase")).toThrow();
  });
});

// ── Donation Flow ──

describe("CreditLedger donation flow", () => {
  let ledger: CreditLedger;

  beforeEach(() => {
    ledger = new CreditLedger();
  });

  it("donate() adds to available and donated", () => {
    const tx = ledger.donate("did:key:z6MkDonor", 1000, "Shared 50% of Claude Max capacity");
    expect(tx.type).toBe("donate");
    expect(tx.amount).toBe(1000);

    const bal = ledger.getBalance("did:key:z6MkDonor");
    expect(bal.available).toBe(1000);
    expect(bal.donated).toBe(1000);
    expect(bal.bootstrapped).toBe(0);
  });

  it("donate() rejects non-positive amounts", () => {
    expect(() => ledger.donate("did:key:z6Mk", 0)).toThrow("must be positive");
    expect(() => ledger.donate("did:key:z6Mk", -1)).toThrow("must be positive");
  });

  it("full donate-earn-spend lifecycle", () => {
    // Alice donates capacity → earns credits
    ledger.donate("did:key:z6MkAlice", 500, "Shared Claude Max capacity");
    expect(ledger.getBalance("did:key:z6MkAlice").donated).toBe(500);

    // Alice can now escrow and spend those credits
    ledger.escrow("did:key:z6MkAlice", 300);
    ledger.release("did:key:z6MkAlice", "did:key:z6MkBob", 300);

    const aliceBal = ledger.getBalance("did:key:z6MkAlice");
    expect(aliceBal.available).toBe(200);
    expect(aliceBal.donated).toBe(500);
    expect(aliceBal.spent).toBe(300);

    const bobBal = ledger.getBalance("did:key:z6MkBob");
    expect(bobBal.available).toBe(300);
    expect(bobBal.earned).toBe(300);
  });

  it("bootstrap() is separate from donate()", () => {
    ledger.bootstrap("did:key:z6MkAgent", 200, "Sign-up bonus");
    ledger.donate("did:key:z6MkAgent", 800, "Shared capacity");

    const bal = ledger.getBalance("did:key:z6MkAgent");
    expect(bal.available).toBe(1000);
    expect(bal.bootstrapped).toBe(200);
    expect(bal.donated).toBe(800);
  });

  it("deprecated purchase() still works as bootstrap()", () => {
    const tx = ledger.purchase("did:key:z6MkAgent", 500);
    expect(tx.type).toBe("bootstrap");

    const bal = ledger.getBalance("did:key:z6MkAgent");
    expect(bal.available).toBe(500);
    expect(bal.bootstrapped).toBe(500);
  });
});

// ── Capacity-Based Discovery ──

describe("Capacity-based discovery filtering", () => {
  it("filters by preferredProvider", () => {
    const anthropicAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: ["typescript"] }],
      trustTier: "open-internet",
      endpoint: "https://agent1/alxp",
      capacitySource: {
        provider: "anthropic",
        tier: "max",
        capacityType: "messages",
      },
    });

    const localAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: ["typescript"] }],
      trustTier: "open-internet",
      endpoint: "https://agent2/alxp",
      capacitySource: {
        provider: "local",
        tier: "local-gpu",
        capacityType: "unlimited-local",
      },
    });

    // Filter for anthropic
    expect(matchesQuery(anthropicAgent, { domain: "code-generation", preferredProvider: "anthropic" })).toBe(true);
    expect(matchesQuery(localAgent, { domain: "code-generation", preferredProvider: "anthropic" })).toBe(false);
  });

  it("filters out local models when acceptLocalModels is false", () => {
    const localAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://local/alxp",
      capacitySource: {
        provider: "local",
        tier: "local-gpu",
        capacityType: "unlimited-local",
      },
    });

    const cloudAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://cloud/alxp",
      capacitySource: {
        provider: "anthropic",
        tier: "pro",
        capacityType: "tokens",
      },
    });

    expect(matchesQuery(localAgent, { domain: "code-generation", acceptLocalModels: false })).toBe(false);
    expect(matchesQuery(cloudAgent, { domain: "code-generation", acceptLocalModels: false })).toBe(true);
    // acceptLocalModels true or undefined should accept both
    expect(matchesQuery(localAgent, { domain: "code-generation", acceptLocalModels: true })).toBe(true);
    expect(matchesQuery(localAgent, { domain: "code-generation" })).toBe(true);
  });

  it("filters by minRemainingCapacity", () => {
    const highCapAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://high/alxp",
      capacitySnapshot: { remainingShared: 500 },
    });

    const lowCapAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://low/alxp",
      capacitySnapshot: { remainingShared: 50 },
    });

    const noCapAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://none/alxp",
    });

    expect(matchesQuery(highCapAgent, { domain: "code-generation", minRemainingCapacity: 100 })).toBe(true);
    expect(matchesQuery(lowCapAgent, { domain: "code-generation", minRemainingCapacity: 100 })).toBe(false);
    // Agent without snapshot fails minimum capacity check
    expect(matchesQuery(noCapAgent, { domain: "code-generation", minRemainingCapacity: 100 })).toBe(false);
  });

  it("registry query with capacity filters", () => {
    const registry = new AgentRegistry();

    const anthropicAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://a/alxp",
      capacitySource: { provider: "anthropic", tier: "max", capacityType: "messages" },
      capacitySnapshot: { remainingShared: 500 },
    });

    const localAgent = generateAgentCard({
      identity: generateAgentIdentity(),
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://b/alxp",
      capacitySource: { provider: "local", tier: "local-gpu", capacityType: "unlimited-local" },
      capacitySnapshot: { remainingShared: 10000 },
    });

    registry.register(anthropicAgent);
    registry.register(localAgent);

    // Both match general query
    expect(registry.query({ domain: "code-generation" })).toHaveLength(2);

    // Only anthropic matches provider filter
    expect(registry.query({ domain: "code-generation", preferredProvider: "anthropic" })).toHaveLength(1);

    // Only cloud matches when local excluded
    expect(registry.query({ domain: "code-generation", acceptLocalModels: false })).toHaveLength(1);
  });
});

// ── Provider-Aware Pricing ──

describe("Provider-aware pricing", () => {
  it("Claude Max capacity costs more credits", () => {
    const baseCost = calculateCreditCost("medium");
    const maxCost = calculateCreditCost("medium", { providerTier: "anthropic:max" });
    expect(maxCost).toBeGreaterThan(baseCost);
    expect(maxCost).toBe(Math.round(500 * 1.5)); // 750
  });

  it("local GPU capacity costs fewer credits", () => {
    const baseCost = calculateCreditCost("medium");
    const localCost = calculateCreditCost("medium", { providerTier: "local:local-gpu" });
    expect(localCost).toBeLessThan(baseCost);
    expect(localCost).toBe(Math.round(500 * 0.7)); // 350
  });

  it("unknown provider tier uses multiplier of 1", () => {
    const baseCost = calculateCreditCost("medium");
    const unknownCost = calculateCreditCost("medium", { providerTier: "mystery:custom" });
    expect(unknownCost).toBe(baseCost);
  });

  it("provider tier stacks with complexity adjustment", () => {
    // medium base = 500, anthropic:pro = 1.2x, +50% complexity = 1.5x
    const cost = calculateCreditCost("medium", {
      providerTier: "anthropic:pro",
      complexityAdjustment: 0.5,
    });
    expect(cost).toBe(Math.round(500 * 1.5 * 1.2)); // 900
  });
});

// ── Heartbeat with Capacity Snapshot ──

describe("Heartbeat with capacitySnapshot", () => {
  it("recordHeartbeat captures capacity snapshot", () => {
    const tracker = new HeartbeatTracker({ staleTimeout: 60000 });
    const hb: Heartbeat = {
      type: "HEARTBEAT",
      agentId: "did:key:z6MkAgent1" as any,
      status: "online",
      capacity: 0.8,
      currentTasks: 0,
      capacitySnapshot: {
        remainingInPeriod: 800,
        remainingShared: 400,
        utilizationRate: 0.2,
      },
    };

    const state = tracker.recordHeartbeat(hb);
    expect(state.capacitySnapshot?.remainingShared).toBe(400);
    expect(state.capacitySnapshot?.utilizationRate).toBe(0.2);
  });

  it("hasRemainingCapacity returns true when snapshot is absent", () => {
    const state = {
      agentId: "did:key:z6Mk" as any,
      status: "online" as const,
      capacity: 0.8,
      currentTasks: 0,
      lastHeartbeat: new Date(),
      missedHeartbeats: 0,
    };
    expect(hasRemainingCapacity(state)).toBe(true);
  });

  it("hasRemainingCapacity returns false when remainingShared is 0", () => {
    const state = {
      agentId: "did:key:z6Mk" as any,
      status: "online" as const,
      capacity: 0.8,
      currentTasks: 0,
      capacitySnapshot: { remainingShared: 0 },
      lastHeartbeat: new Date(),
      missedHeartbeats: 0,
    };
    expect(hasRemainingCapacity(state)).toBe(false);
  });

  it("hasRemainingCapacity returns true when remainingShared is positive", () => {
    const state = {
      agentId: "did:key:z6Mk" as any,
      status: "online" as const,
      capacity: 0.8,
      currentTasks: 0,
      capacitySnapshot: { remainingShared: 500 },
      lastHeartbeat: new Date(),
      missedHeartbeats: 0,
    };
    expect(hasRemainingCapacity(state)).toBe(true);
  });
});

// ── QuotaRemaining with capacity fields ──

describe("QuotaRemaining with capacity fields", () => {
  it("accepts capacityRemaining and periodRenewsAt", () => {
    const qr = QuotaRemaining.parse({
      tokensThisHour: 80000,
      capacityRemaining: 5000,
      periodRenewsAt: "2026-04-01T00:00:00.000Z",
    });
    expect(qr.capacityRemaining).toBe(5000);
    expect(qr.periodRenewsAt).toBe("2026-04-01T00:00:00.000Z");
  });
});

// ── Agent Card with Capacity Source ──

describe("generateAgentCard with capacity fields", () => {
  it("includes capacitySource and capacitySnapshot", () => {
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      capacitySource: {
        provider: "anthropic",
        tier: "max",
        planName: "Claude Max",
        capacityType: "messages",
        sharedCapacity: 500,
        modelAccess: ["claude-sonnet-4", "claude-opus-4"],
      },
      capacitySnapshot: {
        remainingShared: 350,
        utilizationRate: 0.3,
      },
    });

    expect(card.capacitySource?.provider).toBe("anthropic");
    expect(card.capacitySource?.tier).toBe("max");
    expect(card.capacitySource?.sharedCapacity).toBe(500);
    expect(card.capacitySnapshot?.remainingShared).toBe(350);
  });
});

// ── Full Capacity Sharing Lifecycle ──

describe("Capacity sharing lifecycle", () => {
  it("donate capacity → earn credits → spend credits → use others' capacity", async () => {
    const ledger = new CreditLedger();
    const settlement = new CreditSettlementAdapter(ledger);

    const alice = generateAgentIdentity(); // Claude Max subscriber
    const bob = generateAgentIdentity();   // Ollama/local GPU

    // Alice donates capacity from her Claude Max subscription
    ledger.donate(alice.did, 1000, "Shared 50% of Claude Max monthly capacity");
    expect(ledger.getBalance(alice.did).donated).toBe(1000);
    expect(ledger.getBalance(alice.did).available).toBe(1000);

    // Bob donates local GPU time
    ledger.donate(bob.did, 500, "Shared RTX 4090 compute time");
    expect(ledger.getBalance(bob.did).donated).toBe(500);

    // Alice uses Bob's local GPU for a draft task (costs 200 credits)
    const contract1Id = ulid();
    const task1Id = ulid();
    const contract1: TaskContract = {
      id: contract1Id,
      taskId: task1Id,
      offerId: ulid(),
      requester: alice.did,
      worker: bob.did,
      agreedPrice: { amount: 200, currency: "credits", model: "fixed" },
      agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
      agreedVerification: { method: "automated" },
      delegationGrant: {
        issuer: alice.did,
        audience: bob.did,
        capabilities: ["context/read"],
        expiration: new Date(Date.now() + 3600000).toISOString(),
        token: signString(contract1Id, alice.keyPair.privateKey),
      },
      cancellationPolicy: { allowedBy: "both", penaltyPercent: 0 },
      requesterSignature: signString(contract1Id, alice.keyPair.privateKey),
      workerSignature: signString(contract1Id, bob.keyPair.privateKey),
      formed: new Date().toISOString(),
    } as TaskContract;

    const escrow1 = await settlement.createEscrow(contract1);
    const receipt1: WorkReceipt = {
      id: ulid(),
      contractId: contract1Id,
      taskId: task1Id,
      requester: alice.did,
      worker: bob.did,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      taskDomain: "code-generation",
      effortTier: "low",
      requesterSignature: signString(ulid(), alice.keyPair.privateKey),
      workerSignature: signString(ulid(), bob.keyPair.privateKey),
    } as WorkReceipt;
    await settlement.releaseEscrow(escrow1.id, receipt1);

    // Bob earned 200 from Alice
    expect(ledger.getBalance(bob.did).earned).toBe(200);
    expect(ledger.getBalance(bob.did).available).toBe(700); // 500 donated + 200 earned

    // Alice spent 200
    expect(ledger.getBalance(alice.did).spent).toBe(200);
    expect(ledger.getBalance(alice.did).available).toBe(800);

    // Bob uses Alice's Claude capacity for a polish task (costs 400 credits)
    const contract2Id = ulid();
    const task2Id = ulid();
    const contract2: TaskContract = {
      id: contract2Id,
      taskId: task2Id,
      offerId: ulid(),
      requester: bob.did,
      worker: alice.did,
      agreedPrice: { amount: 400, currency: "credits", model: "fixed" },
      agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
      agreedVerification: { method: "automated" },
      delegationGrant: {
        issuer: bob.did,
        audience: alice.did,
        capabilities: ["context/read"],
        expiration: new Date(Date.now() + 3600000).toISOString(),
        token: signString(contract2Id, bob.keyPair.privateKey),
      },
      cancellationPolicy: { allowedBy: "both", penaltyPercent: 0 },
      requesterSignature: signString(contract2Id, bob.keyPair.privateKey),
      workerSignature: signString(contract2Id, alice.keyPair.privateKey),
      formed: new Date().toISOString(),
    } as TaskContract;

    const escrow2 = await settlement.createEscrow(contract2);
    const receipt2: WorkReceipt = {
      id: ulid(),
      contractId: contract2Id,
      taskId: task2Id,
      requester: bob.did,
      worker: alice.did,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      taskDomain: "code-generation",
      effortTier: "medium",
      requesterSignature: signString(ulid(), bob.keyPair.privateKey),
      workerSignature: signString(ulid(), alice.keyPair.privateKey),
    } as WorkReceipt;
    await settlement.releaseEscrow(escrow2.id, receipt2);

    // Final state: both shared capacity, both benefited
    const aliceFinal = ledger.getBalance(alice.did);
    expect(aliceFinal.donated).toBe(1000);
    expect(aliceFinal.earned).toBe(400);
    expect(aliceFinal.spent).toBe(200);
    expect(aliceFinal.available).toBe(1200); // 1000 - 200 + 400

    const bobFinal = ledger.getBalance(bob.did);
    expect(bobFinal.donated).toBe(500);
    expect(bobFinal.earned).toBe(200);
    expect(bobFinal.spent).toBe(400);
    expect(bobFinal.available).toBe(300); // 500 + 200 - 400

    // Nobody paid extra money — they used capacity they already had
    expect(aliceFinal.bootstrapped).toBe(0);
    expect(bobFinal.bootstrapped).toBe(0);
  });
});
