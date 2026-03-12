import { z } from "zod";
import { DID, ULID, ISO8601, Signature } from "./primitives.js";
import { SubscriptionProvider } from "./exchange.js";
import {
  CompensationType,
  CompensationPeriod,
  FiatValuation,
} from "./compensation.js";

// ── Accounting Enums ──

/**
 * Valuation method for credit-to-fiat conversion.
 * Ordered by current availability — cost-basis and provider-list-price
 * are available now; market-rate and fair-market-value require a liquid
 * credit market that does not yet exist.
 */
export const ValuationMethod = z.enum([
  "cost-basis",
  "provider-list-price",
  "weighted-average",
  "market-rate",
  "fair-market-value",
  "custom",
]);
export type ValuationMethod = z.infer<typeof ValuationMethod>;

/** Type of taxable event */
export const TaxEventType = z.enum([
  "comp-income",
  "vest-event",
  "usage-benefit",
  "forfeit-reversal",
  "clawback-adjustment",
  "sharing-income",
]);
export type TaxEventType = z.infer<typeof TaxEventType>;

/** Report type */
export const ReportType = z.enum([
  "w2-supplemental",
  "1099-misc",
  "annual-comp-summary",
  "quarterly-usage",
  "audit-trail",
  "cost-center",
  "custom",
]);
export type ReportType = z.infer<typeof ReportType>;

// ── Core Objects ──

/** Valuation inputs — transparent audit trail for how a fiat value was computed */
export const ValuationInputs = z.object({
  providerRates: z
    .array(
      z.object({
        provider: SubscriptionProvider,
        model: z.string().optional(),
        inputTokenRate: z.number().nonnegative().optional(),
        outputTokenRate: z.number().nonnegative().optional(),
        effectiveDate: ISO8601,
        source: z.string(),
      }),
    )
    .optional(),

  marketData: z
    .object({
      exchangeRate: z.number(),
      volume24h: z.number().nonnegative().optional(),
      source: z.string(),
      sampleDate: ISO8601,
    })
    .optional(),

  costBasis: z
    .object({
      totalCost: z.number().nonnegative(),
      totalCredits: z.number().nonnegative(),
      costPerCredit: z.number().nonnegative(),
      sourceContract: z.string().optional(),
    })
    .optional(),

  weights: z
    .array(
      z.object({
        method: ValuationMethod,
        weight: z.number().min(0).max(1),
        value: z.number(),
      }),
    )
    .optional(),
});
export type ValuationInputs = z.infer<typeof ValuationInputs>;

/** Point-in-time valuation of compute credits in fiat terms */
export const ValuationRecord = z.object({
  id: ULID,
  timestamp: ISO8601,

  creditAmount: z.number().nonnegative(),
  creditTransactionId: ULID.optional(),

  fiatValue: FiatValuation,
  valuationMethod: ValuationMethod,
  valuationInputs: ValuationInputs,

  allocationId: ULID.optional(),
  employeeDid: DID.optional(),
  employerDid: DID.optional(),
  jurisdiction: z.string().optional(),

  computedBy: DID,
  signature: Signature,
});
export type ValuationRecord = z.infer<typeof ValuationRecord>;

/** Taxable event from compute compensation */
export const TaxEvent = z.object({
  id: ULID,
  type: TaxEventType,
  timestamp: ISO8601,

  employee: DID,
  employer: DID,

  creditAmount: z.number(),
  fiatValue: FiatValuation,
  valuationRecordId: ULID,

  allocationId: ULID,
  compensationType: CompensationType,
  transactionId: ULID.optional(),

  jurisdiction: z.string(),
  taxYear: z.number().int(),
  taxQuarter: z.number().int().min(1).max(4).optional(),

  description: z.string(),
  signature: Signature,
});
export type TaxEvent = z.infer<typeof TaxEvent>;

/** Compensation report — periodic, for employer or employee perspective */
export const CompensationReport = z.object({
  id: ULID,
  type: ReportType,
  perspective: z.enum(["employer", "employee"]),

  period: z.object({
    startDate: ISO8601,
    endDate: ISO8601,
    taxYear: z.number().int(),
    label: z.string(),
  }),

  employeeDid: DID.optional(),
  employerDid: DID,
  jurisdiction: z.string(),

  summary: z.object({
    totalCompGranted: z.number().nonnegative(),
    totalCompVested: z.number().nonnegative(),
    totalCompUsed: z.number().nonnegative(),
    totalFiatValue: FiatValuation,
    totalForfeited: z.number().nonnegative(),
    netTaxableValue: FiatValuation,
  }),

  taxEvents: z.array(TaxEvent),
  valuationRecords: z.array(ValuationRecord),
  transactionIds: z.array(ULID),

  workforceSummary: z
    .object({
      employeeCount: z.number().int().nonnegative(),
      totalCompExpense: FiatValuation,
      avgPerEmployee: FiatValuation,
      byBudgetGroup: z.array(
        z.object({
          group: z.string(),
          totalExpense: FiatValuation,
          headcount: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),

  generated: ISO8601,
  signature: Signature,
});
export type CompensationReport = z.infer<typeof CompensationReport>;

/** Cost center record — maps compute to cost centers for financial planning */
export const CostCenterRecord = z.object({
  id: ULID,
  orgId: DID,
  costCenter: z.string(),
  costCenterName: z.string(),
  period: CompensationPeriod,

  creditsConsumed: z.number().nonnegative(),
  fiatCost: FiatValuation,

  byEmployee: z.array(
    z.object({
      employeeDid: DID,
      creditsUsed: z.number().nonnegative(),
      cost: FiatValuation,
    }),
  ),

  byProvider: z.array(
    z.object({
      provider: SubscriptionProvider,
      creditsUsed: z.number().nonnegative(),
      cost: FiatValuation,
    }),
  ),

  byDomain: z.array(
    z.object({
      domain: z.string(),
      creditsUsed: z.number().nonnegative(),
      cost: FiatValuation,
    }),
  ),

  timestamp: ISO8601,
  signature: Signature,
});
export type CostCenterRecord = z.infer<typeof CostCenterRecord>;

/** Retention requirement marker */
export const RetentionRequirement = z.object({
  objectType: z.string(),
  minRetentionYears: z.number().int().positive(),
  jurisdiction: z.string(),
  legalBasis: z.string(),
});
export type RetentionRequirement = z.infer<typeof RetentionRequirement>;

/** W-2 supplemental data shape for platform export */
export const W2SupplementalData = z.object({
  employeeName: z.string(),
  employeeTIN: z.string(),
  employerEIN: z.string(),
  taxYear: z.number().int(),
  computeCompensation: z.number().nonnegative(),
  description: z.literal("AI Compute Compensation"),
});
export type W2SupplementalData = z.infer<typeof W2SupplementalData>;

/** Form 1099-MISC data shape for platform export */
export const Form1099MiscData = z.object({
  recipientName: z.string(),
  recipientTIN: z.string(),
  payerEIN: z.string(),
  taxYear: z.number().int(),
  nonemployeeComp: z.number().nonnegative(),
  description: z.literal("AI Compute Compensation"),
});
export type Form1099MiscData = z.infer<typeof Form1099MiscData>;
