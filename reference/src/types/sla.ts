import { z } from "zod";
import { DID, ULID, ISO8601, Duration, Signature, EffortTier } from "./primitives.js";

// ── SLA Enums ──

/** SLA metric type — capacity-utilization is the primary compensation metric */
export const SLAMetricType = z.enum([
  "capacity-utilization",
  "availability",
  "latency-p95",
  "error-rate",
  "throughput",
]);
export type SLAMetricType = z.infer<typeof SLAMetricType>;

/** SLA lifecycle state */
export const SLAState = z.enum(["active", "warning", "breached", "expired"]);
export type SLAState = z.infer<typeof SLAState>;

/** Remediation action type */
export const RemediationType = z.enum([
  "credit-extension",
  "provider-failover",
  "notification-only",
]);
export type RemediationType = z.infer<typeof RemediationType>;

// ── Core Objects ──

/** SLA scope — what entity an SLA applies to */
export const SLAScope = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent"),
    agentId: DID,
  }),
  z.object({
    type: z.literal("org-capacity"),
    orgId: DID,
    capacitySourceId: ULID.optional(),
  }),
  z.object({
    type: z.literal("allocation"),
    allocationId: ULID,
    employeeDid: DID,
  }),
]);
export type SLAScope = z.infer<typeof SLAScope>;

/** SLA target — a specific measurable commitment */
export const SLATarget = z.object({
  metric: SLAMetricType,
  target: z.number(),
  unit: z.string(),
  window: Duration,
  windowType: z.enum(["rolling", "calendar"]),
  warningThreshold: z.number().optional(),
  breachThreshold: z.number(),
});
export type SLATarget = z.infer<typeof SLATarget>;

/** Monitoring configuration — periodic compliance from metering data */
export const MonitoringConfig = z.object({
  reportingInterval: Duration,
  dataSource: z.enum(["metering-reports", "credit-transactions", "both"]),
  heartbeatRequired: z.boolean().optional(),
  heartbeatInterval: Duration.optional(),
  alertOnWarning: z.boolean(),
  alertOnBreach: z.boolean(),
  alertRecipients: z.array(DID),
});
export type MonitoringConfig = z.infer<typeof MonitoringConfig>;

/** Remediation action — what to do on warning or breach */
export const RemediationAction = z.object({
  trigger: z.enum(["warning", "breach"]),
  action: RemediationType,
  creditExtensionPercent: z.number().min(0).max(1).optional(),
  notifyDids: z.array(DID).optional(),
});
export type RemediationAction = z.infer<typeof RemediationAction>;

/** Remediation policy — evaluated at reporting boundaries, not real-time */
export const RemediationPolicy = z.object({
  actions: z.array(RemediationAction),
  maxRemediationCredits: z.number().nonnegative().optional(),
});
export type RemediationPolicy = z.infer<typeof RemediationPolicy>;

/** SLA definition — declaration of service level commitments */
export const SLADefinition = z.object({
  id: ULID,
  name: z.string(),

  scope: SLAScope,
  effortTier: EffortTier.optional(),

  targets: z.array(SLATarget),
  monitoringConfig: MonitoringConfig,
  remediationPolicy: RemediationPolicy,

  effectiveDate: ISO8601,
  expiresAt: ISO8601.optional(),
  state: SLAState,

  owner: DID,
  created: ISO8601,
  updated: ISO8601,
  signature: Signature,
});
export type SLADefinition = z.infer<typeof SLADefinition>;

/** SLA compliance report — periodic, generated at end of reporting window */
export const SLAReport = z.object({
  id: ULID,
  slaId: ULID,

  period: z.object({
    start: ISO8601,
    end: ISO8601,
    label: z.string(),
  }),

  compliant: z.boolean(),
  state: SLAState,

  metrics: z.array(
    z.object({
      metric: SLAMetricType,
      target: z.number(),
      actual: z.number(),
      compliant: z.boolean(),
      dataPoints: z.number().int().nonnegative(),
    }),
  ),

  capacityDetail: z
    .object({
      allocatedCredits: z.number().nonnegative(),
      usableCredits: z.number().nonnegative(),
      utilizationRate: z.number().min(0).max(1),
      consumedCredits: z.number().nonnegative(),
      shortfallCredits: z.number().nonnegative().optional(),
    })
    .optional(),

  remediations: z
    .array(
      z.object({
        type: RemediationType,
        creditsExtended: z.number().nonnegative().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),

  generated: ISO8601,
  signature: Signature,
});
export type SLAReport = z.infer<typeof SLAReport>;

/** Compensation-specific SLA guarantee */
export const CompensationSLA = z.object({
  allocationId: ULID,
  employee: DID,
  employer: DID,

  guarantees: z.object({
    capacityUtilization: z.number().min(0).max(1),
    period: Duration,
    modelAvailability: z.array(z.string()).optional(),
  }),

  remediation: z.object({
    action: RemediationType,
    creditExtensionPercent: z.number().min(0).max(1).optional(),
  }),
});
export type CompensationSLA = z.infer<typeof CompensationSLA>;
