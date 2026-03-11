import { describe, it, expect } from "vitest";
import { generateAgentIdentity } from "../src/identity/did.js";
import {
  generateAgentCard,
  matchesQuery,
  canHandleEffortTier,
  checkBidEligibility,
  suggestPromotion,
  calculateCreditCost,
  EFFORT_MULTIPLIERS,
  EFFORT_VERIFICATION,
} from "../src/discovery/agent-card.js";
import { AgentRegistry } from "../src/discovery/registry.js";
import type { EffortTier } from "../src/types/primitives.js";

// Helper to create an agent card with a specific capability tier
function makeAgent(
  capabilityTier: EffortTier,
  domain = "code-generation",
  effortHistory?: { tier: EffortTier; tasksCompleted: number; successRate: number; avgQualityScore: number }[],
) {
  const identity = generateAgentIdentity();
  return generateAgentCard({
    identity,
    capabilities: [{ domain, tags: ["typescript"] }],
    trustTier: "open-internet",
    endpoint: `https://${identity.did}/alxp`,
    capabilityTier,
    effortHistory,
  });
}

// ── matchesQuery with effort tier ──

describe("matchesQuery with effort tier", () => {
  it("filters agents by effort tier eligibility", () => {
    const lowAgent = makeAgent("low");
    const highAgent = makeAgent("high");

    // Low agent can handle trivial and low, not medium+
    expect(matchesQuery(lowAgent, { domain: "code-generation", effortTier: "trivial" })).toBe(true);
    expect(matchesQuery(lowAgent, { domain: "code-generation", effortTier: "low" })).toBe(true);
    expect(matchesQuery(lowAgent, { domain: "code-generation", effortTier: "medium" })).toBe(false);

    // High agent can handle up to high
    expect(matchesQuery(highAgent, { domain: "code-generation", effortTier: "medium" })).toBe(true);
    expect(matchesQuery(highAgent, { domain: "code-generation", effortTier: "high" })).toBe(true);
    expect(matchesQuery(highAgent, { domain: "code-generation", effortTier: "critical" })).toBe(false);
  });

  it("agent without capabilityTier can only handle trivial", () => {
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      // no capabilityTier
    });

    expect(matchesQuery(card, { domain: "code-generation", effortTier: "trivial" })).toBe(true);
    expect(matchesQuery(card, { domain: "code-generation", effortTier: "low" })).toBe(false);
  });

  it("query without effortTier matches all agents (backward compat)", () => {
    const lowAgent = makeAgent("low");
    expect(matchesQuery(lowAgent, { domain: "code-generation" })).toBe(true);
  });

  it("onlineOnly filters out offline agents", () => {
    const identity = generateAgentIdentity();
    const offlineCard = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      availability: { status: "offline" },
    });

    expect(matchesQuery(offlineCard, { domain: "code-generation", onlineOnly: true })).toBe(false);
    expect(matchesQuery(offlineCard, { domain: "code-generation", onlineOnly: false })).toBe(true);
    expect(matchesQuery(offlineCard, { domain: "code-generation" })).toBe(true);
  });

  it("busy agents are still returned (they may have capacity)", () => {
    const identity = generateAgentIdentity();
    const busyCard = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      availability: { status: "busy" },
    });

    expect(matchesQuery(busyCard, { domain: "code-generation", onlineOnly: true })).toBe(true);
  });
});

// ── canHandleEffortTier ──

describe("canHandleEffortTier", () => {
  it("checks all tier combinations correctly", () => {
    const tiers: EffortTier[] = ["trivial", "low", "medium", "high", "critical"];

    for (let agentIdx = 0; agentIdx < tiers.length; agentIdx++) {
      const agent = makeAgent(tiers[agentIdx]!);

      for (let taskIdx = 0; taskIdx <= agentIdx; taskIdx++) {
        expect(canHandleEffortTier(agent, tiers[taskIdx]!)).toBe(true);
      }

      for (let taskIdx = agentIdx + 1; taskIdx < tiers.length; taskIdx++) {
        expect(canHandleEffortTier(agent, tiers[taskIdx]!)).toBe(false);
      }
    }
  });
});

// ── checkBidEligibility ──

describe("checkBidEligibility", () => {
  it("allows eligible agents", () => {
    const agent = makeAgent("high");
    const result = checkBidEligibility(agent, "medium");
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects under-capable agents", () => {
    const agent = makeAgent("low");
    const result = checkBidEligibility(agent, "high");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("below required");
  });

  it("demotes agents with poor track record", () => {
    const agent = makeAgent("high", "code-generation", [
      { tier: "high", tasksCompleted: 15, successRate: 0.3, avgQualityScore: 0.4 },
    ]);

    const result = checkBidEligibility(agent, "high");
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("30%");
  });

  it("does not demote with too few tasks", () => {
    const agent = makeAgent("high", "code-generation", [
      { tier: "high", tasksCompleted: 3, successRate: 0.2, avgQualityScore: 0.3 },
    ]);

    // Only 3 tasks — below default demotionMinTasks of 10
    const result = checkBidEligibility(agent, "high");
    expect(result.eligible).toBe(true);
  });

  it("respects custom demotion thresholds", () => {
    const agent = makeAgent("high", "code-generation", [
      { tier: "high", tasksCompleted: 15, successRate: 0.6, avgQualityScore: 0.7 },
    ]);

    // Default threshold is 0.5, so 0.6 is fine
    expect(checkBidEligibility(agent, "high").eligible).toBe(true);

    // With stricter threshold
    expect(
      checkBidEligibility(agent, "high", { demotionThreshold: 0.7 }).eligible,
    ).toBe(false);
  });
});

// ── suggestPromotion ──

describe("suggestPromotion", () => {
  it("suggests promotion when track record is strong", () => {
    const agent = makeAgent("medium", "code-generation", [
      { tier: "medium", tasksCompleted: 25, successRate: 0.92, avgQualityScore: 0.9 },
    ]);

    expect(suggestPromotion(agent)).toBe("high");
  });

  it("does not suggest promotion with insufficient tasks", () => {
    const agent = makeAgent("medium", "code-generation", [
      { tier: "medium", tasksCompleted: 10, successRate: 0.95, avgQualityScore: 0.95 },
    ]);

    expect(suggestPromotion(agent)).toBeNull();
  });

  it("does not suggest promotion with low success rate", () => {
    const agent = makeAgent("medium", "code-generation", [
      { tier: "medium", tasksCompleted: 30, successRate: 0.6, avgQualityScore: 0.7 },
    ]);

    expect(suggestPromotion(agent)).toBeNull();
  });

  it("does not promote beyond critical", () => {
    const agent = makeAgent("critical", "code-generation", [
      { tier: "critical", tasksCompleted: 100, successRate: 1.0, avgQualityScore: 1.0 },
    ]);

    expect(suggestPromotion(agent)).toBeNull();
  });

  it("respects custom thresholds", () => {
    const agent = makeAgent("low", "code-generation", [
      { tier: "low", tasksCompleted: 10, successRate: 0.85, avgQualityScore: 0.8 },
    ]);

    // Default minTasks is 20, so null
    expect(suggestPromotion(agent)).toBeNull();

    // With lower threshold
    expect(suggestPromotion(agent, { minTasks: 5 })).toBe("medium");
  });

  it("promotes through the full tier ladder", () => {
    const tiers: EffortTier[] = ["trivial", "low", "medium", "high"];
    const expected: EffortTier[] = ["low", "medium", "high", "critical"];

    for (let i = 0; i < tiers.length; i++) {
      const agent = makeAgent(tiers[i]!, "code-generation", [
        { tier: tiers[i]!, tasksCompleted: 25, successRate: 0.9, avgQualityScore: 0.9 },
      ]);
      expect(suggestPromotion(agent)).toBe(expected[i]);
    }
  });
});

// ── calculateCreditCost ──

describe("calculateCreditCost", () => {
  it("applies default multipliers", () => {
    expect(calculateCreditCost("trivial")).toBe(100);   // 100 * 1
    expect(calculateCreditCost("low")).toBe(200);       // 100 * 2
    expect(calculateCreditCost("medium")).toBe(500);    // 100 * 5
    expect(calculateCreditCost("high")).toBe(1000);     // 100 * 10
    expect(calculateCreditCost("critical")).toBe(2500); // 100 * 25
  });

  it("uses custom base rate", () => {
    expect(calculateCreditCost("medium", { baseCreditRate: 50 })).toBe(250);
  });

  it("applies complexity adjustment", () => {
    // +50% complexity
    expect(calculateCreditCost("medium", { complexityAdjustment: 0.5 })).toBe(750);
    // -30% complexity
    expect(calculateCreditCost("medium", { complexityAdjustment: -0.3 })).toBe(350);
  });

  it("accepts custom multipliers", () => {
    const custom: Record<EffortTier, number> = {
      trivial: 1,
      low: 3,
      medium: 8,
      high: 15,
      critical: 30,
    };
    expect(calculateCreditCost("medium", { customMultipliers: custom })).toBe(800);
  });

  it("rounds to whole credits", () => {
    // 100 * 5 * 1.33 = 665
    expect(calculateCreditCost("medium", { complexityAdjustment: 0.33 })).toBe(665);
  });
});

// ── EFFORT_MULTIPLIERS and EFFORT_VERIFICATION ──

describe("Effort tier constants", () => {
  it("has multipliers for all tiers", () => {
    const tiers: EffortTier[] = ["trivial", "low", "medium", "high", "critical"];
    for (const tier of tiers) {
      expect(EFFORT_MULTIPLIERS[tier]).toBeGreaterThan(0);
    }
  });

  it("multipliers are monotonically increasing", () => {
    const tiers: EffortTier[] = ["trivial", "low", "medium", "high", "critical"];
    for (let i = 1; i < tiers.length; i++) {
      expect(EFFORT_MULTIPLIERS[tiers[i]!]).toBeGreaterThan(EFFORT_MULTIPLIERS[tiers[i - 1]!]);
    }
  });

  it("has verification defaults for all tiers", () => {
    expect(EFFORT_VERIFICATION["trivial"]).toBe("automated");
    expect(EFFORT_VERIFICATION["low"]).toBe("automated");
    expect(EFFORT_VERIFICATION["medium"]).toBe("optimistic");
    expect(EFFORT_VERIFICATION["high"]).toBe("optimistic");
    expect(EFFORT_VERIFICATION["critical"]).toBe("consensus");
  });
});

// ── Registry query with effort tier ──

describe("AgentRegistry with effort tier queries", () => {
  it("filters agents by effort tier in registry queries", () => {
    const registry = new AgentRegistry();

    const lowAgent = makeAgent("low");
    const medAgent = makeAgent("medium");
    const highAgent = makeAgent("high");

    registry.register(lowAgent);
    registry.register(medAgent);
    registry.register(highAgent);

    // All match code-generation domain
    expect(registry.query({ domain: "code-generation" })).toHaveLength(3);

    // Only medium+ can handle medium tasks
    expect(registry.query({ domain: "code-generation", effortTier: "medium" })).toHaveLength(2);

    // Only high can handle high tasks
    expect(registry.query({ domain: "code-generation", effortTier: "high" })).toHaveLength(1);

    // No one can handle critical
    expect(registry.query({ domain: "code-generation", effortTier: "critical" })).toHaveLength(0);
  });

  it("combines effort tier with other filters", () => {
    const registry = new AgentRegistry();

    const identity1 = generateAgentIdentity();
    const agent1 = generateAgentCard({
      identity: identity1,
      capabilities: [{ domain: "code-generation", subDomain: "typescript", confidenceLevel: 0.9, tags: ["typescript"] }],
      trustTier: "open-internet",
      endpoint: `https://${identity1.did}/alxp`,
      capabilityTier: "high",
    });

    const identity2 = generateAgentIdentity();
    const agent2 = generateAgentCard({
      identity: identity2,
      capabilities: [{ domain: "code-generation", subDomain: "python", confidenceLevel: 0.8, tags: ["python"] }],
      trustTier: "open-internet",
      endpoint: `https://${identity2.did}/alxp`,
      capabilityTier: "high",
    });

    registry.register(agent1);
    registry.register(agent2);

    // Both are high-tier code-generation
    expect(registry.query({ domain: "code-generation", effortTier: "high" })).toHaveLength(2);

    // Only one is typescript
    expect(
      registry.query({ domain: "code-generation", effortTier: "high", subDomain: "typescript" }),
    ).toHaveLength(1);
  });
});

// ── generateAgentCard with exchange fields ──

describe("generateAgentCard with exchange fields", () => {
  it("includes capabilityTier and effortHistory", () => {
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      capabilityTier: "high",
      effortHistory: [
        { tier: "medium", tasksCompleted: 50, successRate: 0.95, avgQualityScore: 0.9 },
      ],
    });

    expect(card.capabilityTier).toBe("high");
    expect(card.effortHistory).toHaveLength(1);
    expect(card.effortHistory![0]!.tier).toBe("medium");
  });

  it("includes availability overrides (schedule, quotas)", () => {
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "code-generation", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test/alxp",
      availability: {
        status: "online",
        capacity: 0.7,
        schedule: [
          { dayOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", capacity: 0.8 },
        ],
        quotas: { maxConcurrentTasks: 3, maxTokensPerDay: 5000000 },
      },
    });

    expect(card.availability.capacity).toBe(0.7);
    expect(card.availability.schedule).toHaveLength(1);
    expect(card.availability.quotas?.maxConcurrentTasks).toBe(3);
  });
});
