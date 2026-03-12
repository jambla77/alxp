import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";
import { TaskSpec } from "./task.js";
import { Offer } from "./offer.js";
import { TaskContract } from "./contract.js";
import { ContextEnvelope } from "./context.js";
import { ResultBundle } from "./result.js";
import { WorkReceipt } from "./receipt.js";
import { DisputeRecord } from "./dispute.js";
import { Challenge } from "./staking.js";
import { ValidatorAssessment } from "./consensus.js";
import { MeteringReport, QuotaRemaining, CapacitySnapshot, SubscriptionProvider } from "./exchange.js";
import {
  ComputeAllocation,
  CompensationPeriod,
  FiatValuation,
  OperationalConstraints,
  EconomicConstraints,
} from "./compensation.js";
import { OrgBudget } from "./employer.js";
import { SLADefinition, SLAReport } from "./sla.js";
import { ValuationRecord, TaxEvent, ReportType } from "./accounting.js";

/** Settlement proof */
export const SettlementProof = z.object({
  type: z.string(),
  ref: z.string(),
  timestamp: ISO8601,
});
export type SettlementProof = z.infer<typeof SettlementProof>;

// ── The Six Core Message Payloads ──

export const AnnounceTask = z.object({
  type: z.literal("ANNOUNCE_TASK"),
  taskSpec: TaskSpec,
});
export type AnnounceTask = z.infer<typeof AnnounceTask>;

export const Bid = z.object({
  type: z.literal("BID"),
  offer: Offer,
});
export type Bid = z.infer<typeof Bid>;

export const Award = z.object({
  type: z.literal("AWARD"),
  contract: TaskContract,
  contextEnvelope: ContextEnvelope.optional(),
});
export type Award = z.infer<typeof Award>;

export const SubmitResult = z.object({
  type: z.literal("SUBMIT_RESULT"),
  result: ResultBundle,
});
export type SubmitResult = z.infer<typeof SubmitResult>;

export const Verify = z.object({
  type: z.literal("VERIFY"),
  contractId: ULID,
  verdict: z.enum(["accepted", "rejected", "disputed"]),
  receipt: WorkReceipt.optional(),
  disputeRecord: DisputeRecord.optional(),
  feedback: z.string().optional(),
});
export type Verify = z.infer<typeof Verify>;

export const Settle = z.object({
  type: z.literal("SETTLE"),
  contractId: ULID,
  receipt: WorkReceipt,
  settlementProof: SettlementProof.optional(),
});
export type Settle = z.infer<typeof Settle>;

/** Challenge a pending result (Tier 2) */
export const ChallengeResult = z.object({
  type: z.literal("CHALLENGE_RESULT"),
  challenge: Challenge,
});
export type ChallengeResult = z.infer<typeof ChallengeResult>;

/** Submit a validator assessment (Tier 3) */
export const ValidatorAssess = z.object({
  type: z.literal("VALIDATOR_ASSESS"),
  assessment: ValidatorAssessment,
});
export type ValidatorAssess = z.infer<typeof ValidatorAssess>;

// ── Compensation Layer Messages ──

/** Employer grants a compute allocation to an employee */
export const CompAllocate = z.object({
  type: z.literal("COMP_ALLOCATE"),
  allocation: ComputeAllocation,
});
export type CompAllocate = z.infer<typeof CompAllocate>;

/** Vesting event — credits move from unvested to vested */
export const CompVest = z.object({
  type: z.literal("COMP_VEST"),
  allocationId: ULID,
  employee: DID,
  amountVested: z.number().nonnegative(),
  totalVestedAfter: z.number().nonnegative(),
  vestingEvent: ISO8601,
  nextVestingEvent: ISO8601.optional(),
});
export type CompVest = z.infer<typeof CompVest>;

/** Unvested credits forfeited */
export const CompForfeit = z.object({
  type: z.literal("COMP_FORFEIT"),
  allocationId: ULID,
  employee: DID,
  amountForfeited: z.number().nonnegative(),
  reason: z.enum(["termination", "expiration", "policy-change", "voluntary"]),
  effectiveDate: ISO8601,
});
export type CompForfeit = z.infer<typeof CompForfeit>;

/** Periodic compute usage report against compensation allocations */
export const CompUsageReport = z.object({
  type: z.literal("COMP_USAGE_REPORT"),
  employee: DID,
  employer: DID,
  period: CompensationPeriod,
  allocations: z.array(
    z.object({
      allocationId: ULID,
      creditsUsed: z.number().nonnegative(),
      creditsRemaining: z.number().nonnegative(),
      topDomains: z.array(z.object({ domain: z.string(), credits: z.number().nonnegative() })),
      topProviders: z.array(z.object({ provider: z.string(), credits: z.number().nonnegative() })),
    }),
  ),
  totalUsed: z.number().nonnegative(),
  totalRemaining: z.number().nonnegative(),
  timestamp: ISO8601,
  signature: Signature,
});
export type CompUsageReport = z.infer<typeof CompUsageReport>;

// ── Employer Model Messages ──

/** Organization creates or updates a budget */
export const BudgetCreate = z.object({
  type: z.literal("BUDGET_CREATE"),
  budget: OrgBudget,
});
export type BudgetCreate = z.infer<typeof BudgetCreate>;

/** Distribute credits from org budget to an individual */
export const BudgetAllocate = z.object({
  type: z.literal("BUDGET_ALLOCATE"),
  fromBudget: ULID,
  toEmployee: DID,
  amount: z.number().nonnegative(),
  budgetGroup: z.string().optional(),
  operationalConstraints: OperationalConstraints.optional(),
  economicConstraints: EconomicConstraints.optional(),
  approver: DID,
  delegationProof: z.string().min(1),
});
export type BudgetAllocate = z.infer<typeof BudgetAllocate>;

/** Advisory: budget threshold reached */
export const BudgetWarning = z.object({
  type: z.literal("BUDGET_WARNING"),
  budgetId: ULID,
  warningType: z.enum(["threshold-reached", "over-allocated", "expiring-soon", "utilization-low"]),
  threshold: z.number().min(0).max(1),
  currentUsage: z.number().nonnegative(),
  totalBudget: z.number().nonnegative(),
  message: z.string(),
  timestamp: ISO8601,
});
export type BudgetWarning = z.infer<typeof BudgetWarning>;

/** Aggregated organizational usage report */
export const OrgUsageReport = z.object({
  type: z.literal("ORG_USAGE_REPORT"),
  orgId: DID,
  period: CompensationPeriod,
  summary: z.object({
    totalBudget: z.number().nonnegative(),
    totalAllocated: z.number().nonnegative(),
    totalConsumed: z.number().nonnegative(),
    utilizationRate: z.number().min(0).max(1),
    memberCount: z.number().int().nonnegative(),
    avgPerMember: z.number().nonnegative(),
  }),
  byBudgetGroup: z.array(
    z.object({
      group: z.string(),
      allocated: z.number().nonnegative(),
      consumed: z.number().nonnegative(),
      utilizationRate: z.number().min(0).max(1),
      headcount: z.number().int().nonnegative(),
    }),
  ),
  byProvider: z.array(
    z.object({
      provider: SubscriptionProvider,
      creditsConsumed: z.number().nonnegative(),
      estimatedCost: FiatValuation.optional(),
    }),
  ),
  topConsumers: z.array(
    z.object({
      employeeDid: DID,
      creditsUsed: z.number().nonnegative(),
      topDomains: z.array(z.string()),
    }),
  ),
  timestamp: ISO8601,
  signature: Signature,
});
export type OrgUsageReport = z.infer<typeof OrgUsageReport>;

// ── SLA Messages ──

/** Agent or organization publishes SLA commitments */
export const SlaDeclare = z.object({
  type: z.literal("SLA_DECLARE"),
  sla: SLADefinition,
});
export type SlaDeclare = z.infer<typeof SlaDeclare>;

/** Periodic SLA compliance report */
export const SlaReportMsg = z.object({
  type: z.literal("SLA_REPORT"),
  report: SLAReport,
});
export type SlaReportMsg = z.infer<typeof SlaReportMsg>;

// ── Accounting Messages ──

/** New valuation computed */
export const ValuationRecordMsg = z.object({
  type: z.literal("VALUATION_RECORD"),
  record: ValuationRecord,
});
export type ValuationRecordMsg = z.infer<typeof ValuationRecordMsg>;

/** Taxable event occurred */
export const TaxEventMsg = z.object({
  type: z.literal("TAX_EVENT"),
  event: TaxEvent,
});
export type TaxEventMsg = z.infer<typeof TaxEventMsg>;

/** Compensation report generated */
export const ReportGenerated = z.object({
  type: z.literal("REPORT_GENERATED"),
  reportId: ULID,
  reportType: ReportType,
  period: CompensationPeriod,
  summary: z.object({
    totalCompGranted: z.number().nonnegative(),
    totalCompVested: z.number().nonnegative(),
    totalCompUsed: z.number().nonnegative(),
    totalFiatValue: FiatValuation,
    totalForfeited: z.number().nonnegative(),
    netTaxableValue: FiatValuation,
  }),
  downloadUrl: z.string().url().optional(),
});
export type ReportGenerated = z.infer<typeof ReportGenerated>;

// ── Exchange Layer Messages ──

/** Agent heartbeat — liveness and capacity signal */
export const Heartbeat = z.object({
  type: z.literal("HEARTBEAT"),
  agentId: DID,
  status: z.enum(["online", "busy", "offline"]),
  capacity: z.number().min(0).max(1),
  currentTasks: z.number().int().nonnegative(),
  quotaRemaining: QuotaRemaining.optional(),
  capacitySnapshot: CapacitySnapshot.optional(),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

/** Interim metering update during task execution */
export const MeteringUpdate = z.object({
  type: z.literal("METERING_UPDATE"),
  contractId: ULID,
  report: MeteringReport,
});
export type MeteringUpdate = z.infer<typeof MeteringUpdate>;

/** Discriminated union of all message payloads */
export const MessagePayload = z.discriminatedUnion("type", [
  // Core lifecycle
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
  Settle,
  ChallengeResult,
  ValidatorAssess,
  // Exchange
  Heartbeat,
  MeteringUpdate,
  // Compensation
  CompAllocate,
  CompVest,
  CompForfeit,
  CompUsageReport,
  // Employer
  BudgetCreate,
  BudgetAllocate,
  BudgetWarning,
  OrgUsageReport,
  // SLA
  SlaDeclare,
  SlaReportMsg,
  // Accounting
  ValuationRecordMsg,
  TaxEventMsg,
  ReportGenerated,
]);
export type MessagePayload = z.infer<typeof MessagePayload>;

/** Protocol version */
export const PROTOCOL_VERSION = "alxp/0.1" as const;

/** Protocol message envelope — wraps every message on the wire */
export const ProtocolMessage = z.object({
  version: z.literal(PROTOCOL_VERSION),
  id: ULID,
  timestamp: ISO8601,
  sender: DID,
  recipient: DID.optional(),
  replyTo: ULID.optional(),

  payload: MessagePayload,

  headers: z.record(z.string(), z.string()).optional(),

  signature: Signature,
});
export type ProtocolMessage = z.infer<typeof ProtocolMessage>;
