import { z } from "zod";
import { DID, ISO8601, ULID, Signature, EffortTier } from "./primitives.js";

// ── Effort ──

/** Effort estimate — requester's estimate of task resource needs */
export const EffortEstimate = z.object({
  expectedTokens: z.number().int().nonnegative().optional(),
  expectedDuration: z.string().regex(/^P/, "Must be an ISO 8601 duration").optional(),
  expectedSteps: z.number().int().nonnegative().optional(),
});
export type EffortEstimate = z.infer<typeof EffortEstimate>;

/** Effort history — track record at a specific effort tier */
export const EffortHistory = z.object({
  tier: EffortTier,
  tasksCompleted: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgQualityScore: z.number().min(0).max(1),
});
export type EffortHistory = z.infer<typeof EffortHistory>;

// ── Credits ──

/** Credit balance for an agent */
export const CreditBalance = z.object({
  agentId: DID,
  available: z.number().nonnegative(),
  escrowed: z.number().nonnegative(),
  earned: z.number().nonnegative(),
  spent: z.number().nonnegative(),
  purchased: z.number().nonnegative(),
  lastUpdated: ISO8601,
});
export type CreditBalance = z.infer<typeof CreditBalance>;

/** Credit transaction type */
export const CreditTransactionType = z.enum([
  "earn",
  "spend",
  "escrow",
  "release",
  "refund",
  "purchase",
  "grant",
  "bonus",
  "slash",
]);
export type CreditTransactionType = z.infer<typeof CreditTransactionType>;

/** Credit transaction — a single credit movement */
export const CreditTransaction = z.object({
  id: ULID,
  agentId: DID,
  type: CreditTransactionType,
  amount: z.number(),
  balance: z.number(),
  relatedTaskId: ULID.optional(),
  relatedContractId: ULID.optional(),
  counterparty: DID.optional(),
  description: z.string().optional(),
  timestamp: ISO8601,
  signature: Signature,
});
export type CreditTransaction = z.infer<typeof CreditTransaction>;

// ── Metering ──

/** Usage breakdown by category */
export const UsageBreakdown = z.object({
  category: z.string(),
  amount: z.number().nonnegative(),
});
export type UsageBreakdown = z.infer<typeof UsageBreakdown>;

/** Metering report — resource consumption for a task */
export const MeteringReport = z.object({
  id: ULID,
  contractId: ULID,
  taskId: ULID,
  worker: DID,

  period: z.object({
    start: ISO8601,
    end: ISO8601,
  }),

  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
    reasoningSteps: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    apiCalls: z.number().int().nonnegative().optional(),
  }),

  cost: z.object({
    creditsConsumed: z.number().nonnegative(),
    breakdown: z.array(UsageBreakdown).optional(),
  }),

  signature: Signature,
});
export type MeteringReport = z.infer<typeof MeteringReport>;

// ── Agent Pools ──

/** Pool admission policy */
export const PoolPolicy = z.object({
  admission: z.enum(["open", "approval", "invitation"]),
  minReputation: z.number().min(0).max(1).optional(),
  minEffortTier: EffortTier.optional(),
  revenueShare: z.number().min(0).max(1).optional(),
});
export type PoolPolicy = z.infer<typeof PoolPolicy>;

/** Agent pool — a logical group of agents */
export const AgentPool = z.object({
  id: ULID,
  name: z.string(),
  owner: DID,
  members: z.array(DID),
  policy: PoolPolicy,
  created: ISO8601,
});
export type AgentPool = z.infer<typeof AgentPool>;

// ── Quota Remaining (for heartbeats) ──

/** Remaining quota snapshot */
export const QuotaRemaining = z.object({
  tokensThisHour: z.number().int().nonnegative().optional(),
  tokensThisDay: z.number().int().nonnegative().optional(),
  tasksThisHour: z.number().int().nonnegative().optional(),
  tasksThisDay: z.number().int().nonnegative().optional(),
});
export type QuotaRemaining = z.infer<typeof QuotaRemaining>;
