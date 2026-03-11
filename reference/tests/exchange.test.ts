import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import {
  EffortTier,
  AvailabilityWindow,
  AgentQuotas,
  AvailabilityInfo,
  EffortEstimate,
  EffortHistory,
  CreditBalance,
  CreditTransaction,
  CreditTransactionType,
  MeteringReport,
  AgentPool,
  PoolPolicy,
  QuotaRemaining,
  AgentDescription,
  TaskSpec,
  Offer,
  WorkReceipt,
  MessagePayload,
} from "../src/types/index.js";

describe("Exchange Layer Schemas", () => {
  // ── EffortTier ──

  describe("EffortTier", () => {
    it("should accept all valid tiers", () => {
      for (const tier of ["trivial", "low", "medium", "high", "critical"]) {
        expect(EffortTier.parse(tier)).toBe(tier);
      }
    });

    it("should reject invalid tiers", () => {
      expect(() => EffortTier.parse("extreme")).toThrow();
      expect(() => EffortTier.parse("")).toThrow();
    });
  });

  // ── AvailabilityWindow ──

  describe("AvailabilityWindow", () => {
    it("should parse a valid window", () => {
      const window = AvailabilityWindow.parse({
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        timezone: "America/New_York",
        capacity: 0.8,
      });
      expect(window.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
      expect(window.startTime).toBe("09:00");
      expect(window.capacity).toBe(0.8);
    });

    it("should default dayOfWeek to empty and capacity to 1", () => {
      const window = AvailabilityWindow.parse({
        startTime: "00:00",
        endTime: "23:59",
      });
      expect(window.dayOfWeek).toEqual([]);
      expect(window.capacity).toBe(1);
    });

    it("should reject invalid time format", () => {
      expect(() =>
        AvailabilityWindow.parse({
          startTime: "9am",
          endTime: "5pm",
        }),
      ).toThrow();
    });

    it("should reject dayOfWeek out of range", () => {
      expect(() =>
        AvailabilityWindow.parse({
          dayOfWeek: [7],
          startTime: "09:00",
          endTime: "17:00",
        }),
      ).toThrow();
    });
  });

  // ── AgentQuotas ──

  describe("AgentQuotas", () => {
    it("should parse full quotas", () => {
      const quotas = AgentQuotas.parse({
        maxTokensPerHour: 100000,
        maxTokensPerDay: 1000000,
        maxTasksPerHour: 10,
        maxTasksPerDay: 50,
        maxConcurrentTasks: 3,
        maxCreditsPerDay: 500,
        reservedCapacity: 0.2,
      });
      expect(quotas.maxTokensPerDay).toBe(1000000);
      expect(quotas.reservedCapacity).toBe(0.2);
    });

    it("should accept empty quotas (all optional)", () => {
      const quotas = AgentQuotas.parse({});
      expect(quotas.maxTokensPerDay).toBeUndefined();
    });

    it("should reject negative values", () => {
      expect(() => AgentQuotas.parse({ maxTokensPerDay: -1 })).toThrow();
    });

    it("should reject reservedCapacity > 1", () => {
      expect(() => AgentQuotas.parse({ reservedCapacity: 1.5 })).toThrow();
    });
  });

  // ── Extended AvailabilityInfo ──

  describe("AvailabilityInfo (extended)", () => {
    it("should still parse minimal (backward compat)", () => {
      const info = AvailabilityInfo.parse({ status: "online" });
      expect(info.status).toBe("online");
      expect(info.schedule).toBeUndefined();
      expect(info.quotas).toBeUndefined();
    });

    it("should parse full availability with schedule and quotas", () => {
      const info = AvailabilityInfo.parse({
        status: "online",
        capacity: 0.7,
        avgLatencyMs: 1200,
        schedule: [
          {
            dayOfWeek: [1, 2, 3, 4, 5],
            startTime: "09:00",
            endTime: "22:00",
            capacity: 0.8,
          },
        ],
        quotas: {
          maxTokensPerDay: 5000000,
          maxConcurrentTasks: 3,
          reservedCapacity: 0.2,
        },
        poolId: "01ABC",
        lastHeartbeat: "2026-03-11T14:30:00.000Z",
      });
      expect(info.schedule).toHaveLength(1);
      expect(info.quotas?.maxConcurrentTasks).toBe(3);
      expect(info.poolId).toBe("01ABC");
    });
  });

  // ── EffortEstimate ──

  describe("EffortEstimate", () => {
    it("should parse a full estimate", () => {
      const est = EffortEstimate.parse({
        expectedTokens: 250000,
        expectedDuration: "PT30M",
        expectedSteps: 15,
      });
      expect(est.expectedTokens).toBe(250000);
    });

    it("should accept empty estimate (all optional)", () => {
      const est = EffortEstimate.parse({});
      expect(est.expectedTokens).toBeUndefined();
    });
  });

  // ── EffortHistory ──

  describe("EffortHistory", () => {
    it("should parse valid history", () => {
      const h = EffortHistory.parse({
        tier: "medium",
        tasksCompleted: 47,
        successRate: 0.94,
        avgQualityScore: 0.88,
      });
      expect(h.tier).toBe("medium");
      expect(h.tasksCompleted).toBe(47);
    });

    it("should reject invalid tier", () => {
      expect(() =>
        EffortHistory.parse({
          tier: "impossible",
          tasksCompleted: 1,
          successRate: 1,
          avgQualityScore: 1,
        }),
      ).toThrow();
    });
  });

  // ── CreditBalance ──

  describe("CreditBalance", () => {
    it("should parse a valid balance", () => {
      const bal = CreditBalance.parse({
        agentId: "did:key:z6MkTest",
        available: 1500,
        escrowed: 500,
        earned: 3000,
        spent: 1000,
        bootstrapped: 0,
        donated: 0,
        consumed: 0,
        lastUpdated: "2026-03-11T14:30:00.000Z",
      });
      expect(bal.available).toBe(1500);
      expect(bal.earned).toBe(3000);
    });

    it("should reject negative balance", () => {
      expect(() =>
        CreditBalance.parse({
          agentId: "did:key:z6MkTest",
          available: -100,
          escrowed: 0,
          earned: 0,
          spent: 0,
          bootstrapped: 0,
          donated: 0,
          consumed: 0,
          lastUpdated: "2026-03-11T14:30:00.000Z",
        }),
      ).toThrow();
    });
  });

  // ── CreditTransaction ──

  describe("CreditTransaction", () => {
    it("should parse all transaction types", () => {
      const types = ["earn", "spend", "escrow", "release", "refund", "bootstrap", "donate", "grant", "bonus", "slash"];
      for (const t of types) {
        expect(CreditTransactionType.parse(t)).toBe(t);
      }
    });

    it("should parse a full transaction", () => {
      const tx = CreditTransaction.parse({
        id: ulid(),
        agentId: "did:key:z6MkTest",
        type: "earn",
        amount: 500,
        balance: 1500,
        relatedTaskId: ulid(),
        relatedContractId: ulid(),
        counterparty: "did:key:z6MkOther",
        description: "Completed coding task",
        timestamp: "2026-03-11T14:30:00.000Z",
        signature: "sig123",
      });
      expect(tx.type).toBe("earn");
      expect(tx.amount).toBe(500);
    });
  });

  // ── MeteringReport ──

  describe("MeteringReport", () => {
    it("should parse a valid report", () => {
      const report = MeteringReport.parse({
        id: ulid(),
        contractId: ulid(),
        taskId: ulid(),
        worker: "did:key:z6MkWorker",
        period: {
          start: "2026-03-11T14:00:00.000Z",
          end: "2026-03-11T14:30:00.000Z",
        },
        usage: {
          inputTokens: 50000,
          outputTokens: 25000,
          totalTokens: 75000,
          wallClockMs: 180000,
          reasoningSteps: 12,
          toolCalls: 5,
        },
        cost: {
          creditsConsumed: 150,
          breakdown: [
            { category: "inference", amount: 120 },
            { category: "tool-use", amount: 30 },
          ],
        },
        signature: "sig456",
      });
      expect(report.usage.totalTokens).toBe(75000);
      expect(report.cost.creditsConsumed).toBe(150);
      expect(report.cost.breakdown).toHaveLength(2);
    });
  });

  // ── AgentPool ──

  describe("AgentPool", () => {
    it("should parse a valid pool", () => {
      const pool = AgentPool.parse({
        id: ulid(),
        name: "Open Coding Pool",
        owner: "did:key:z6MkOwner",
        members: ["did:key:z6MkAgent1", "did:key:z6MkAgent2"],
        policy: {
          admission: "open",
          minReputation: 0.5,
          minEffortTier: "low",
          revenueShare: 0.1,
        },
        created: "2026-03-01T00:00:00.000Z",
      });
      expect(pool.members).toHaveLength(2);
      expect(pool.policy.admission).toBe("open");
    });

    it("should accept minimal pool policy", () => {
      const pool = AgentPool.parse({
        id: ulid(),
        name: "Private Pool",
        owner: "did:key:z6MkOwner",
        members: [],
        policy: { admission: "invitation" },
        created: "2026-03-01T00:00:00.000Z",
      });
      expect(pool.policy.minReputation).toBeUndefined();
    });
  });

  // ── QuotaRemaining ──

  describe("QuotaRemaining", () => {
    it("should parse with all fields", () => {
      const qr = QuotaRemaining.parse({
        tokensThisHour: 80000,
        tokensThisDay: 4500000,
        tasksThisHour: 8,
        tasksThisDay: 45,
      });
      expect(qr.tokensThisHour).toBe(80000);
    });

    it("should accept empty (all optional)", () => {
      const qr = QuotaRemaining.parse({});
      expect(qr.tokensThisHour).toBeUndefined();
    });
  });

  // ── Extended Core Types ──

  describe("AgentDescription with exchange fields", () => {
    it("should accept capabilityTier and effortHistory", () => {
      const card = AgentDescription.parse({
        id: "did:key:z6MkTest",
        publicKey: "abc123",
        endpoints: [{ url: "https://agent.example.com/alxp", transport: "https" }],
        capabilities: [{ domain: "code-generation", tags: ["typescript"] }],
        trustTier: "open-internet",
        availability: { status: "online" },
        capabilityTier: "high",
        effortHistory: [
          { tier: "medium", tasksCompleted: 47, successRate: 0.94, avgQualityScore: 0.88 },
          { tier: "high", tasksCompleted: 12, successRate: 0.83, avgQualityScore: 0.85 },
        ],
        created: "2026-03-01T00:00:00.000Z",
        updated: "2026-03-11T14:30:00.000Z",
        signature: "sig789",
      });
      expect(card.capabilityTier).toBe("high");
      expect(card.effortHistory).toHaveLength(2);
    });

    it("should still parse without exchange fields (backward compat)", () => {
      const card = AgentDescription.parse({
        id: "did:key:z6MkTest",
        publicKey: "abc123",
        endpoints: [{ url: "https://agent.example.com/alxp", transport: "https" }],
        capabilities: [{ domain: "code-generation", tags: ["typescript"] }],
        trustTier: "open-internet",
        availability: { status: "online" },
        created: "2026-03-01T00:00:00.000Z",
        updated: "2026-03-11T14:30:00.000Z",
        signature: "sig789",
      });
      expect(card.capabilityTier).toBeUndefined();
      expect(card.effortHistory).toBeUndefined();
    });
  });

  describe("TaskSpec with exchange fields", () => {
    const minimalTask = {
      id: ulid(),
      requester: "did:key:z6MkRequester",
      created: "2026-03-11T15:00:00.000Z",
      objective: "Build a blog CMS",
      domain: "code-generation",
      expectedOutput: { mimeType: "application/zip" },
      privacyClass: "public" as const,
      delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
      acceptanceCriteria: [{ type: "rubric" as const, rubric: "Working code", minScore: 0.8 }],
      verificationMethod: "automated" as const,
      signature: "sig123",
    };

    it("should accept effortTier, effortEstimate, creditReward", () => {
      const task = TaskSpec.parse({
        ...minimalTask,
        effortTier: "high",
        effortEstimate: {
          expectedTokens: 250000,
          expectedDuration: "PT30M",
          expectedSteps: 15,
        },
        creditReward: 1200,
      });
      expect(task.effortTier).toBe("high");
      expect(task.effortEstimate?.expectedTokens).toBe(250000);
      expect(task.creditReward).toBe(1200);
    });

    it("should still parse without exchange fields (backward compat)", () => {
      const task = TaskSpec.parse(minimalTask);
      expect(task.effortTier).toBeUndefined();
      expect(task.creditReward).toBeUndefined();
    });
  });

  describe("Offer with exchange fields", () => {
    const minimalOffer = {
      id: ulid(),
      taskId: ulid(),
      worker: "did:key:z6MkWorker",
      created: "2026-03-11T15:00:00.000Z",
      expires: "2026-03-11T16:00:00.000Z",
      price: { amount: 100, currency: "credits", model: "fixed" as const },
      estimatedDuration: "PT1H",
      confidence: 0.9,
      signature: "sig456",
    };

    it("should accept proposedEffortTier and proposedCreditPrice", () => {
      const offer = Offer.parse({
        ...minimalOffer,
        proposedEffortTier: "medium",
        proposedCreditPrice: 450,
      });
      expect(offer.proposedEffortTier).toBe("medium");
      expect(offer.proposedCreditPrice).toBe(450);
    });

    it("should still parse without exchange fields (backward compat)", () => {
      const offer = Offer.parse(minimalOffer);
      expect(offer.proposedEffortTier).toBeUndefined();
    });
  });

  describe("WorkReceipt with exchange fields", () => {
    it("should accept effortTier", () => {
      const receipt = WorkReceipt.parse({
        id: ulid(),
        contractId: ulid(),
        taskId: ulid(),
        requester: "did:key:z6MkRequester",
        worker: "did:key:z6MkWorker",
        status: "accepted",
        acceptedAt: "2026-03-11T16:00:00.000Z",
        taskDomain: "code-generation",
        effortTier: "high",
        requesterSignature: "sigR",
        workerSignature: "sigW",
      });
      expect(receipt.effortTier).toBe("high");
    });
  });

  // ── New Message Types ──

  describe("Heartbeat message", () => {
    it("should parse a valid HEARTBEAT payload", () => {
      const payload = MessagePayload.parse({
        type: "HEARTBEAT",
        agentId: "did:key:z6MkAgent",
        status: "online",
        capacity: 0.7,
        currentTasks: 2,
        quotaRemaining: {
          tokensThisHour: 80000,
          tokensThisDay: 4500000,
        },
      });
      expect(payload.type).toBe("HEARTBEAT");
    });

    it("should accept HEARTBEAT without quotaRemaining", () => {
      const payload = MessagePayload.parse({
        type: "HEARTBEAT",
        agentId: "did:key:z6MkAgent",
        status: "offline",
        capacity: 0,
        currentTasks: 0,
      });
      expect(payload.type).toBe("HEARTBEAT");
    });
  });

  describe("MeteringUpdate message", () => {
    it("should parse a valid METERING_UPDATE payload", () => {
      const payload = MessagePayload.parse({
        type: "METERING_UPDATE",
        contractId: ulid(),
        report: {
          id: ulid(),
          contractId: ulid(),
          taskId: ulid(),
          worker: "did:key:z6MkWorker",
          period: {
            start: "2026-03-11T14:00:00.000Z",
            end: "2026-03-11T14:15:00.000Z",
          },
          usage: {
            inputTokens: 25000,
            outputTokens: 10000,
            totalTokens: 35000,
            wallClockMs: 90000,
          },
          cost: { creditsConsumed: 75 },
          signature: "sigMetering",
        },
      });
      expect(payload.type).toBe("METERING_UPDATE");
    });
  });
});
