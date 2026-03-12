import { z } from "zod";
import {
  DID,
  ULID,
  ISO8601,
  Duration,
  Signature,
  PublicKey,
} from "./primitives.js";
import { SubscriptionProvider, SubscriptionTier } from "./exchange.js";
import {
  VestingSchedule,
  VestingConfig,
  CompensationPeriod,
  CompensationPackage,
  FiatValuation,
  OperationalConstraints,
  EconomicConstraints,
} from "./compensation.js";

// ── Employer Enums ──

/** Organization role */
export const OrgRole = z.enum([
  "org-admin",
  "budget-owner",
  "employee",
  "contractor",
  "auditor",
]);
export type OrgRole = z.infer<typeof OrgRole>;

/** Budget lifecycle state */
export const BudgetState = z.enum([
  "draft",
  "approved",
  "active",
  "depleted",
  "frozen",
  "closed",
]);
export type BudgetState = z.infer<typeof BudgetState>;

/** Employment status */
export const EmploymentStatus = z.enum([
  "active",
  "on-leave",
  "terminated",
  "contractor",
]);
export type EmploymentStatus = z.infer<typeof EmploymentStatus>;

// ── Core Objects ──

/**
 * Organization capacity source — where compute comes from.
 * Protocol-level because it affects model availability (discovery),
 * cost-basis valuation (accounting), and SLA guarantees (sla).
 */
export const OrgCapacitySource = z.object({
  id: ULID,
  orgId: DID,
  provider: SubscriptionProvider,
  tier: SubscriptionTier,
  planName: z.string().optional(),
  contractId: z.string().optional(),
  totalSeats: z.number().int().nonnegative().optional(),
  totalCapacity: z.number().nonnegative(),
  sharedCapacity: z.number().nonnegative(),
  monthlyCost: FiatValuation.optional(),
  costPerCredit: z.number().nonnegative().optional(),
  modelAccess: z.array(z.string()).optional(),
  active: z.boolean(),
  renewsAt: ISO8601.optional(),
  created: ISO8601,
});
export type OrgCapacitySource = z.infer<typeof OrgCapacitySource>;

/** Organization budget for a fiscal period */
export const OrgBudget = z.object({
  id: ULID,
  orgId: DID,
  state: BudgetState,

  totalCredits: z.number().nonnegative(),
  allocatedCredits: z.number().nonnegative(),
  unallocatedCredits: z.number().nonnegative(),
  consumedCredits: z.number().nonnegative(),

  fiscalPeriod: CompensationPeriod,

  fundingMethod: z.enum(["direct-purchase", "capacity-sharing", "hybrid"]),
  fundingSources: z.array(
    z.object({
      type: z.enum(["purchased", "donated", "earned", "bootstrapped"]),
      amount: z.number().nonnegative(),
      provider: z.string().optional(),
    }),
  ),

  approvedBy: DID.optional(),
  approvedAt: ISO8601.optional(),
  created: ISO8601,
  updated: ISO8601,
  signature: Signature,
});
export type OrgBudget = z.infer<typeof OrgBudget>;

/** Organization member record — flat, no department/team hierarchy */
export const OrgMember = z.object({
  id: ULID,
  orgId: DID,
  employeeDid: DID,

  role: OrgRole,
  status: EmploymentStatus,
  title: z.string().optional(),

  compensationPackage: CompensationPackage.optional(),

  /** Freeform grouping tag — platforms use for dept/team/cost-center hierarchy */
  budgetGroup: z.string().optional(),

  startDate: ISO8601,
  endDate: ISO8601.optional(),

  /** UCAN delegation chain proving authority from org to individual */
  delegationChain: z.array(z.string().min(1)).optional(),

  created: ISO8601,
  updated: ISO8601,
});
export type OrgMember = z.infer<typeof OrgMember>;

/** Organization-wide policies */
export const OrgPolicy = z.object({
  // Allocation defaults
  defaultVestingSchedule: VestingSchedule,
  defaultVestingConfig: VestingConfig,
  maxAllocationPerEmployee: z.number().nonnegative().optional(),
  minAllocationPerEmployee: z.number().nonnegative().optional(),

  // Default constraints for new allocations
  defaultOperationalConstraints: OperationalConstraints.optional(),
  defaultEconomicConstraints: EconomicConstraints.optional(),

  // Usage
  allowPersonalUse: z.boolean(),
  personalUsePercent: z.number().min(0).max(1).optional(),
  allowExternalSharing: z.boolean(),
  externalSharingRevenueShare: z.number().min(0).max(1).optional(),

  // Termination
  vestedCreditsOnTermination: z.enum(["keep", "forfeit", "partial"]),
  unvestedCreditsOnTermination: z.literal("forfeit"),
  terminationGracePeriod: Duration.optional(),

  // For-cause
  forCauseClawback: z.boolean(),
  forCauseClawbackPercent: z.number().min(0).max(1).optional(),

  // Reporting
  reportingFrequency: z.enum(["daily", "weekly", "monthly", "quarterly"]),

  // Rollover
  unusedCreditsRollover: z.boolean(),
  maxRolloverPercent: z.number().min(0).max(1).optional(),
});
export type OrgPolicy = z.infer<typeof OrgPolicy>;

/** Organization — top-level entity for compute compensation */
export const Organization = z.object({
  id: DID,
  name: z.string(),
  domain: z.string().optional(),
  publicKey: PublicKey,

  budget: OrgBudget.optional(),
  capacitySources: z.array(OrgCapacitySource),

  policies: OrgPolicy,

  members: z.array(OrgMember),

  created: ISO8601,
  updated: ISO8601,
  signature: Signature,
});
export type Organization = z.infer<typeof Organization>;
