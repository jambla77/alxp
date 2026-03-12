import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import {
  SLAMetricType,
  SLAState,
  RemediationType,
  SLAScope,
  SLATarget,
  MonitoringConfig,
  RemediationPolicy,
  SLADefinition,
  SLAReport,
  CompensationSLA,
  MessagePayload,
} from "../src/types/index.js";

const AGENT_DID = "did:key:z6MkAgent";
const ORG_DID = "did:key:z6MkOrg";
const EMPLOYEE_DID = "did:key:z6MkEmployee";
const NOW = new Date().toISOString();
const SIG = "test-signature-base64url";

describe("SLA Layer Schemas", () => {
  // ── Enums ──

  describe("SLAMetricType", () => {
    it("should accept all valid metric types", () => {
      for (const m of [
        "capacity-utilization",
        "availability",
        "latency-p95",
        "error-rate",
        "throughput",
      ]) {
        expect(SLAMetricType.parse(m)).toBe(m);
      }
    });

    it("should reject removed metric types", () => {
      expect(() => SLAMetricType.parse("latency-p50")).toThrow();
      expect(() => SLAMetricType.parse("time-to-first-token")).toThrow();
      expect(() => SLAMetricType.parse("recovery-time")).toThrow();
    });
  });

  describe("SLAState", () => {
    it("should accept all valid states", () => {
      for (const s of ["active", "warning", "breached", "expired"]) {
        expect(SLAState.parse(s)).toBe(s);
      }
    });

    it("should reject removed state", () => {
      expect(() => SLAState.parse("suspended")).toThrow();
    });
  });

  describe("RemediationType", () => {
    it("should accept all valid types", () => {
      for (const r of ["credit-extension", "provider-failover", "notification-only"]) {
        expect(RemediationType.parse(r)).toBe(r);
      }
    });

    it("should reject removed types", () => {
      expect(() => RemediationType.parse("credit-refund")).toThrow();
      expect(() => RemediationType.parse("priority-escalation")).toThrow();
      expect(() => RemediationType.parse("capacity-boost")).toThrow();
    });
  });

  // ── SLAScope ──

  describe("SLAScope", () => {
    it("should parse agent scope", () => {
      const result = SLAScope.parse({
        type: "agent",
        agentId: AGENT_DID,
      });
      expect(result.type).toBe("agent");
    });

    it("should parse org-capacity scope", () => {
      const result = SLAScope.parse({
        type: "org-capacity",
        orgId: ORG_DID,
        capacitySourceId: ulid(),
      });
      expect(result.type).toBe("org-capacity");
    });

    it("should parse allocation scope", () => {
      const result = SLAScope.parse({
        type: "allocation",
        allocationId: ulid(),
        employeeDid: EMPLOYEE_DID,
      });
      expect(result.type).toBe("allocation");
    });

    it("should reject removed pool scope", () => {
      expect(() =>
        SLAScope.parse({
          type: "pool",
          poolId: ulid(),
        }),
      ).toThrow();
    });
  });

  // ── SLADefinition ──

  describe("SLADefinition", () => {
    const validSLA = {
      id: ulid(),
      name: "Enterprise Gold SLA",
      scope: { type: "org-capacity" as const, orgId: ORG_DID },
      targets: [
        {
          metric: "capacity-utilization" as const,
          target: 0.95,
          unit: "percent",
          window: "P30D",
          windowType: "calendar" as const,
          warningThreshold: 0.97,
          breachThreshold: 0.95,
        },
      ],
      monitoringConfig: {
        reportingInterval: "P30D",
        dataSource: "both" as const,
        alertOnWarning: true,
        alertOnBreach: true,
        alertRecipients: [ORG_DID],
      },
      remediationPolicy: {
        actions: [
          {
            trigger: "breach" as const,
            action: "credit-extension" as const,
            creditExtensionPercent: 1.0,
          },
        ],
      },
      effectiveDate: NOW,
      state: "active" as const,
      owner: ORG_DID,
      created: NOW,
      updated: NOW,
      signature: SIG,
    };

    it("should parse a valid SLA definition", () => {
      const result = SLADefinition.parse(validSLA);
      expect(result.name).toBe("Enterprise Gold SLA");
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].metric).toBe("capacity-utilization");
    });

    it("should parse SLA with effort tier filter", () => {
      const result = SLADefinition.parse({
        ...validSLA,
        effortTier: "critical",
      });
      expect(result.effortTier).toBe("critical");
    });
  });

  // ── SLAReport ──

  describe("SLAReport", () => {
    it("should parse a compliant report", () => {
      const result = SLAReport.parse({
        id: ulid(),
        slaId: ulid(),
        period: {
          start: "2026-01-01T00:00:00Z",
          end: "2026-01-31T23:59:59Z",
          label: "2026-01",
        },
        compliant: true,
        state: "active",
        metrics: [
          {
            metric: "capacity-utilization",
            target: 0.95,
            actual: 0.97,
            compliant: true,
            dataPoints: 744,
          },
        ],
        capacityDetail: {
          allocatedCredits: 10000,
          usableCredits: 9700,
          utilizationRate: 0.97,
          consumedCredits: 8500,
        },
        generated: NOW,
        signature: SIG,
      });
      expect(result.compliant).toBe(true);
      expect(result.capacityDetail?.utilizationRate).toBe(0.97);
    });

    it("should parse a breached report with remediation", () => {
      const result = SLAReport.parse({
        id: ulid(),
        slaId: ulid(),
        period: {
          start: "2026-01-01T00:00:00Z",
          end: "2026-01-31T23:59:59Z",
          label: "2026-01",
        },
        compliant: false,
        state: "breached",
        metrics: [
          {
            metric: "capacity-utilization",
            target: 0.95,
            actual: 0.85,
            compliant: false,
            dataPoints: 744,
          },
        ],
        capacityDetail: {
          allocatedCredits: 10000,
          usableCredits: 8500,
          utilizationRate: 0.85,
          consumedCredits: 7000,
          shortfallCredits: 1500,
        },
        remediations: [
          {
            type: "credit-extension",
            creditsExtended: 1500,
            notes: "Shortfall compensated for provider outage",
          },
        ],
        generated: NOW,
        signature: SIG,
      });
      expect(result.compliant).toBe(false);
      expect(result.remediations).toHaveLength(1);
      expect(result.capacityDetail?.shortfallCredits).toBe(1500);
    });
  });

  // ── CompensationSLA ──

  describe("CompensationSLA", () => {
    it("should parse a compensation SLA guarantee", () => {
      const result = CompensationSLA.parse({
        allocationId: ulid(),
        employee: EMPLOYEE_DID,
        employer: ORG_DID,
        guarantees: {
          capacityUtilization: 0.95,
          period: "P30D",
          modelAvailability: ["claude-opus-4"],
        },
        remediation: {
          action: "credit-extension",
          creditExtensionPercent: 1.0,
        },
      });
      expect(result.guarantees.capacityUtilization).toBe(0.95);
    });
  });

  // ── SLA Messages ──

  describe("SLA Message Payloads", () => {
    it("should parse SLA_DECLARE message", () => {
      const result = MessagePayload.parse({
        type: "SLA_DECLARE",
        sla: {
          id: ulid(),
          name: "Agent SLA",
          scope: { type: "agent", agentId: AGENT_DID },
          targets: [
            {
              metric: "availability",
              target: 0.99,
              unit: "percent",
              window: "P30D",
              windowType: "rolling",
              breachThreshold: 0.99,
            },
          ],
          monitoringConfig: {
            reportingInterval: "P30D",
            dataSource: "metering-reports",
            heartbeatRequired: true,
            heartbeatInterval: "PT30S",
            alertOnWarning: true,
            alertOnBreach: true,
            alertRecipients: [AGENT_DID],
          },
          remediationPolicy: {
            actions: [
              { trigger: "breach", action: "notification-only" },
            ],
          },
          effectiveDate: NOW,
          state: "active",
          owner: AGENT_DID,
          created: NOW,
          updated: NOW,
          signature: SIG,
        },
      });
      expect(result.type).toBe("SLA_DECLARE");
    });

    it("should parse SLA_REPORT message", () => {
      const result = MessagePayload.parse({
        type: "SLA_REPORT",
        report: {
          id: ulid(),
          slaId: ulid(),
          period: {
            start: "2026-01-01T00:00:00Z",
            end: "2026-03-31T23:59:59Z",
            label: "2026-Q1",
          },
          compliant: true,
          state: "active",
          metrics: [
            {
              metric: "capacity-utilization",
              target: 0.95,
              actual: 0.97,
              compliant: true,
              dataPoints: 2160,
            },
          ],
          generated: NOW,
          signature: SIG,
        },
      });
      expect(result.type).toBe("SLA_REPORT");
    });
  });
});
