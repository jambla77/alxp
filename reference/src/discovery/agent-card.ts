/**
 * Agent Card — the discoverable profile of an ALXP agent.
 *
 * Agent Cards are published at well-known endpoints and registered
 * with discovery services. They extend the A2A Agent Card concept
 * with ALXP-specific fields: cost model, trust tier, reputation refs.
 *
 * Discovery modes:
 * - Mode A: Registry — agents publish cards to known registries
 * - Mode B: Well-known endpoint — GET /.well-known/agent.json
 */

import { signString, publicKeyToHex } from "../identity/signing.js";
import type { AgentIdentity } from "../identity/did.js";
import type {
  AgentDescription as AgentDescriptionType,
  CapabilityDescription as CapabilityDescriptionType,
  TrustTier,
  EffortTier,
  CostModel as CostModelType,
  AvailabilityInfo as AvailabilityInfoType,
} from "../types/index.js";
import type { EffortHistory } from "../types/exchange.js";

/** Options for generating an Agent Card */
export interface AgentCardOptions {
  identity: AgentIdentity;
  name?: string;
  description?: string;
  capabilities: CapabilityDescriptionType[];
  trustTier: TrustTier;
  endpoint: string;
  costModel?: CostModelType;
  jurisdictions?: string[];
  modelInfo?: {
    provider?: string;
    modelId?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  };
  // Exchange layer
  capabilityTier?: EffortTier;
  effortHistory?: EffortHistory[];
  availability?: Partial<AvailabilityInfoType>;
}

/**
 * Generate a signed Agent Card (AgentDescription) from identity and options.
 */
export function generateAgentCard(options: AgentCardOptions): AgentDescriptionType {
  const {
    identity,
    capabilities,
    trustTier,
    endpoint,
    costModel,
    jurisdictions,
    modelInfo,
    capabilityTier,
    effortHistory,
    availability: availabilityOverrides,
  } = options;

  const now = new Date().toISOString();
  const pubHex = publicKeyToHex(identity.keyPair.publicKey);

  const card: AgentDescriptionType = {
    id: identity.did,
    publicKey: pubHex,
    endpoints: [{ url: endpoint, transport: "https" }],
    capabilities,
    tools: [],
    modelInfo,
    costModel,
    availability: { status: "online", ...availabilityOverrides },
    jurisdictions,
    trustTier,
    capabilityTier,
    effortHistory,
    created: now,
    updated: now,
    signature: signString(`${identity.did}:${now}`, identity.keyPair.privateKey),
  };

  return card;
}

/** Capability query for matching agents */
export interface CapabilityQuery {
  domain: string;
  subDomain?: string;
  minConfidence?: number;
  maxPrice?: number;
  priceCurrency?: string;
  requiredTrustTier?: TrustTier;
  tags?: string[];
  // Exchange layer
  effortTier?: EffortTier;
  onlineOnly?: boolean;
}

/** Effort tier ranking (higher number = more capable) */
const EFFORT_TIER_RANK: Record<EffortTier, number> = {
  trivial: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Check if an agent card matches a capability query.
 */
export function matchesQuery(
  card: AgentDescriptionType,
  query: CapabilityQuery,
): boolean {
  // Must have at least one matching capability
  const matchingCap = card.capabilities.find((cap) => {
    // Domain must match
    if (cap.domain !== query.domain) return false;

    // SubDomain must match if specified
    if (query.subDomain && cap.subDomain !== query.subDomain) return false;

    // Confidence must meet minimum
    if (query.minConfidence !== undefined) {
      if ((cap.confidenceLevel ?? 0) < query.minConfidence) return false;
    }

    // Tags must match if specified (all query tags must be present)
    if (query.tags && query.tags.length > 0) {
      if (!query.tags.every((t) => cap.tags.includes(t))) return false;
    }

    return true;
  });

  if (!matchingCap) return false;

  // Trust tier must meet or exceed requirement
  if (query.requiredTrustTier) {
    const tierRank: Record<TrustTier, number> = {
      "open-internet": 0,
      consortium: 1,
      "same-owner": 2,
    };
    if (tierRank[card.trustTier] < tierRank[query.requiredTrustTier]) return false;
  }

  // Price must be within budget
  if (query.maxPrice !== undefined && card.costModel?.basePrice) {
    const currency = query.priceCurrency ?? "USD";
    if (card.costModel.basePrice.currency === currency) {
      if (card.costModel.basePrice.amount > query.maxPrice) return false;
    }
  }

  // Effort tier: agent's capabilityTier must be >= task's effortTier
  if (query.effortTier) {
    if (!canHandleEffortTier(card, query.effortTier)) return false;
  }

  // Online filter
  if (query.onlineOnly && card.availability.status === "offline") {
    return false;
  }

  return true;
}

// ── Effort Tier Utilities ──

/**
 * Check if an agent can handle a given effort tier.
 * Agent's capabilityTier must be >= the required effort tier.
 * If the agent has no capabilityTier declared, it can only handle "trivial".
 */
export function canHandleEffortTier(
  card: AgentDescriptionType,
  effortTier: EffortTier,
): boolean {
  const agentRank = EFFORT_TIER_RANK[card.capabilityTier ?? "trivial"];
  const taskRank = EFFORT_TIER_RANK[effortTier];
  return agentRank >= taskRank;
}

/**
 * Check if an agent is eligible to bid on a task based on effort tier
 * and track record. Returns { eligible, reason }.
 */
export function checkBidEligibility(
  card: AgentDescriptionType,
  effortTier: EffortTier,
  options: BidEligibilityOptions = {},
): BidEligibilityResult {
  const {
    demotionThreshold = 0.5,
    demotionMinTasks = 10,
  } = options;

  // Basic capability check
  if (!canHandleEffortTier(card, effortTier)) {
    return {
      eligible: false,
      reason: `Agent capability tier "${card.capabilityTier ?? "trivial"}" is below required effort tier "${effortTier}"`,
    };
  }

  // If agent has effort history, check track record at this tier
  if (card.effortHistory && card.effortHistory.length > 0) {
    const historyAtTier = card.effortHistory.find((h) => h.tier === effortTier);

    if (historyAtTier && historyAtTier.tasksCompleted >= demotionMinTasks) {
      if (historyAtTier.successRate < demotionThreshold) {
        return {
          eligible: false,
          reason: `Agent success rate at "${effortTier}" tier is ${(historyAtTier.successRate * 100).toFixed(0)}% (below ${(demotionThreshold * 100).toFixed(0)}% threshold over ${historyAtTier.tasksCompleted} tasks)`,
        };
      }
    }
  }

  return { eligible: true };
}

/** Options for bid eligibility checking */
export interface BidEligibilityOptions {
  /** Minimum success rate to remain eligible at a tier (default: 0.5) */
  minSuccessRate?: number;
  /** Minimum tasks at a lower tier before promotion is considered (default: 20) */
  minTasksForPromotion?: number;
  /** Success rate below which an agent is demoted (default: 0.5) */
  demotionThreshold?: number;
  /** Minimum tasks before demotion can trigger (default: 10) */
  demotionMinTasks?: number;
}

/** Result of bid eligibility check */
export interface BidEligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Suggest a capability tier promotion based on effort history.
 * Returns the recommended new tier, or null if no promotion is warranted.
 */
export function suggestPromotion(
  card: AgentDescriptionType,
  options: { minTasks?: number; minSuccessRate?: number } = {},
): EffortTier | null {
  const { minTasks = 20, minSuccessRate = 0.8 } = options;
  const currentTier = card.capabilityTier ?? "trivial";
  const currentRank = EFFORT_TIER_RANK[currentTier];

  if (currentRank >= 4) return null; // Already at critical, can't promote

  const historyAtCurrent = card.effortHistory?.find((h) => h.tier === currentTier);

  if (
    historyAtCurrent &&
    historyAtCurrent.tasksCompleted >= minTasks &&
    historyAtCurrent.successRate >= minSuccessRate
  ) {
    const tiers: EffortTier[] = ["trivial", "low", "medium", "high", "critical"];
    return tiers[currentRank + 1]!;
  }

  return null;
}

// ── Effort-Based Pricing ──

/** Default credit multipliers per effort tier */
export const EFFORT_MULTIPLIERS: Record<EffortTier, number> = {
  trivial: 1,
  low: 2,
  medium: 5,
  high: 10,
  critical: 25,
};

/** Default verification method per effort tier */
export const EFFORT_VERIFICATION: Record<EffortTier, string> = {
  trivial: "automated",
  low: "automated",
  medium: "optimistic",
  high: "optimistic",
  critical: "consensus",
};

/**
 * Calculate credit cost for a task based on effort tier.
 */
export function calculateCreditCost(
  effortTier: EffortTier,
  options: CreditCostOptions = {},
): number {
  const {
    baseCreditRate = 100,
    complexityAdjustment = 0,
    customMultipliers,
  } = options;

  const multipliers = customMultipliers ?? EFFORT_MULTIPLIERS;
  const multiplier = multipliers[effortTier];
  return Math.round(baseCreditRate * multiplier * (1 + complexityAdjustment));
}

/** Options for credit cost calculation */
export interface CreditCostOptions {
  /** Base credit rate (default: 100) */
  baseCreditRate?: number;
  /** Complexity adjustment from -0.5 to 1.0 (default: 0) */
  complexityAdjustment?: number;
  /** Custom multipliers per tier (overrides defaults) */
  customMultipliers?: Record<EffortTier, number>;
}
