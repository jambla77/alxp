import { z } from "zod";
import { DID, ULID, ISO8601, Duration, Signature } from "./primitives.js";
import { SubscriptionProvider } from "./exchange.js";

// ── Compensation Enums ──

/** Type of compute compensation */
export const CompensationType = z.enum([
  "salary-compute",
  "bonus-compute",
  "signing-compute",
  "retention-compute",
  "performance-compute",
  "project-compute",
]);
export type CompensationType = z.infer<typeof CompensationType>;

/** Vesting schedule type */
export const VestingSchedule = z.enum([
  "immediate",
  "cliff",
  "linear",
  "back-loaded",
  "milestone",
]);
export type VestingSchedule = z.infer<typeof VestingSchedule>;

/** State of a compute allocation */
export const AllocationState = z.enum([
  "pending",
  "active",
  "vesting",
  "fully-vested",
  "forfeited",
  "expired",
  "revoked",
]);
export type AllocationState = z.infer<typeof AllocationState>;

// ── Constraints ──

/**
 * Operational constraints — security/compliance restrictions that persist
 * during the employment relationship regardless of vesting status.
 * Removed when employment ends.
 */
export const OperationalConstraints = z.object({
  allowedProviders: z.array(SubscriptionProvider).optional(),
  blockedProviders: z.array(SubscriptionProvider).optional(),
  allowedModels: z.array(z.string()).optional(),
  justification: z.string().optional(),
  complianceFrameworks: z.array(z.string()).optional(),
  dataResidency: z.array(z.string()).optional(),
  requireEncryption: z.boolean().optional(),
  maxCreditsPerDay: z.number().nonnegative().optional(),
  maxCreditsPerTask: z.number().nonnegative().optional(),
  appliesDuring: z.enum(["employment", "employment-plus-grace"]),
  gracePeriod: Duration.optional(),
});
export type OperationalConstraints = z.infer<typeof OperationalConstraints>;

/**
 * Economic constraints — restrictions on portability and usage that apply
 * only to unvested credits. Dropped at vesting to prevent compute
 * compensation from becoming company scrip.
 */
export const EconomicConstraints = z.object({
  allowedDomains: z.array(z.string()).optional(),
  restrictedDomains: z.array(z.string()).optional(),
  allowCapacitySharing: z.boolean(),
  sharingRevenueShare: z.number().min(0).max(1).optional(),
  transferablePreVesting: z.boolean(),
  /** Defaults to true — vested credits survive termination by default */
  survivesTermination: z.boolean().default(true),
  expiresAfterTermination: Duration.optional(),
});
export type EconomicConstraints = z.infer<typeof EconomicConstraints>;

// ── Vesting ──

/** Vesting milestone for milestone-based vesting */
export const VestingMilestone = z.object({
  id: z.string(),
  description: z.string(),
  percent: z.number().min(0).max(1),
  deadline: ISO8601.optional(),
  verifier: DID.optional(),
  completed: z.boolean(),
  completedAt: ISO8601.optional(),
});
export type VestingMilestone = z.infer<typeof VestingMilestone>;

/** Vesting configuration — discriminated union on schedule type */
export const VestingConfig = z.discriminatedUnion("schedule", [
  z.object({
    schedule: z.literal("immediate"),
  }),
  z.object({
    schedule: z.literal("cliff"),
    cliffDuration: Duration,
    cliffPercent: z.number().min(0).max(1),
    postCliffSchedule: z.enum(["linear", "quarterly", "monthly"]).optional(),
    postCliffDuration: Duration.optional(),
  }),
  z.object({
    schedule: z.literal("linear"),
    totalDuration: Duration,
    vestingInterval: Duration,
  }),
  z.object({
    schedule: z.literal("back-loaded"),
    totalDuration: Duration,
    yearlyPercents: z.array(z.number().min(0).max(1)),
  }),
  z.object({
    schedule: z.literal("milestone"),
    milestones: z.array(VestingMilestone),
  }),
]);
export type VestingConfig = z.infer<typeof VestingConfig>;

// ── Compensation Period ──

/** Ties an allocation to a fiscal cycle */
export const CompensationPeriod = z.object({
  year: z.number().int(),
  quarter: z.number().int().min(1).max(4).optional(),
  month: z.number().int().min(1).max(12).optional(),
  label: z.string().optional(),
  startDate: ISO8601,
  endDate: ISO8601,
});
export type CompensationPeriod = z.infer<typeof CompensationPeriod>;

// ── Core Objects ──

/** Fiat-equivalent valuation of compute credits */
export const FiatValuation = z.object({
  amount: z.number(),
  currency: z.string(),
  valuationMethod: z.enum([
    "market-rate",
    "cost-basis",
    "provider-list-price",
    "custom",
  ]),
  effectiveDate: ISO8601,
  provider: z.string().optional(),
  notes: z.string().optional(),
});
export type FiatValuation = z.infer<typeof FiatValuation>;

/** Compute allocation — a grant of credits from employer to employee */
export const ComputeAllocation = z.object({
  id: ULID,
  employer: DID,
  employee: DID,
  type: CompensationType,
  state: AllocationState,

  // Amounts
  totalCredits: z.number().nonnegative(),
  vestedCredits: z.number().nonnegative(),
  unvestedCredits: z.number().nonnegative(),
  usedCredits: z.number().nonnegative(),
  availableCredits: z.number().nonnegative(),

  // Vesting
  vestingSchedule: VestingSchedule,
  vestingConfig: VestingConfig,
  vestingStartDate: ISO8601,
  vestingEndDate: ISO8601.optional(),
  nextVestingEvent: ISO8601.optional(),

  // Constraints
  operationalConstraints: OperationalConstraints.optional(),
  economicConstraints: EconomicConstraints.optional(),

  // Metadata
  compensationPeriod: CompensationPeriod.optional(),
  approver: DID.optional(),
  notes: z.string().optional(),
  created: ISO8601,
  updated: ISO8601,
  employerSignature: Signature,
  employeeSignature: Signature.optional(),
});
export type ComputeAllocation = z.infer<typeof ComputeAllocation>;

/** Complete view of an employee's compute compensation */
export const CompensationPackage = z.object({
  id: ULID,
  employer: DID,
  employee: DID,

  allocations: z.array(ComputeAllocation),

  // Aggregates
  totalGranted: z.number().nonnegative(),
  totalVested: z.number().nonnegative(),
  totalUsed: z.number().nonnegative(),
  totalAvailable: z.number().nonnegative(),
  totalForfeited: z.number().nonnegative(),

  annualizedCredits: z.number().nonnegative(),
  estimatedFiatValue: FiatValuation.optional(),

  effectiveDate: ISO8601,
  updated: ISO8601,
  employerSignature: Signature,
});
export type CompensationPackage = z.infer<typeof CompensationPackage>;
