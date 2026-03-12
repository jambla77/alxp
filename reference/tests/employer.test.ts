import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import {
  OrgRole,
  BudgetState,
  EmploymentStatus,
  OrgCapacitySource,
  OrgBudget,
  OrgMember,
  OrgPolicy,
  Organization,
  MessagePayload,
} from "../src/types/index.js";

const ORG_DID = "did:key:z6MkAcmeCorp";
const EMPLOYEE_DID = "did:key:z6MkAlice";
const NOW = new Date().toISOString();
const SIG = "test-signature-base64url";

describe("Employer Model Schemas", () => {
  // ── Enums ──

  describe("OrgRole", () => {
    it("should accept all valid roles", () => {
      for (const r of ["org-admin", "budget-owner", "employee", "contractor", "auditor"]) {
        expect(OrgRole.parse(r)).toBe(r);
      }
    });

    it("should reject removed roles", () => {
      expect(() => OrgRole.parse("finance-admin")).toThrow();
      expect(() => OrgRole.parse("team-lead")).toThrow();
    });
  });

  describe("BudgetState", () => {
    it("should accept all valid states", () => {
      for (const s of ["draft", "approved", "active", "depleted", "frozen", "closed"]) {
        expect(BudgetState.parse(s)).toBe(s);
      }
    });
  });

  describe("EmploymentStatus", () => {
    it("should accept all valid statuses", () => {
      for (const s of ["active", "on-leave", "terminated", "contractor"]) {
        expect(EmploymentStatus.parse(s)).toBe(s);
      }
    });
  });

  // ── OrgCapacitySource ──

  describe("OrgCapacitySource", () => {
    it("should parse a valid capacity source", () => {
      const result = OrgCapacitySource.parse({
        id: ulid(),
        orgId: ORG_DID,
        provider: "anthropic",
        tier: "enterprise",
        planName: "Anthropic Enterprise",
        contractId: "ENT-2026-001",
        totalSeats: 50,
        totalCapacity: 1000000,
        sharedCapacity: 800000,
        monthlyCost: {
          amount: 50000,
          currency: "USD",
          valuationMethod: "cost-basis",
          effectiveDate: NOW,
        },
        costPerCredit: 0.05,
        modelAccess: ["claude-opus-4", "claude-sonnet-4"],
        active: true,
        renewsAt: NOW,
        created: NOW,
      });
      expect(result.provider).toBe("anthropic");
      expect(result.tier).toBe("enterprise");
      expect(result.totalCapacity).toBe(1000000);
    });

    it("should parse minimal capacity source", () => {
      const result = OrgCapacitySource.parse({
        id: ulid(),
        orgId: ORG_DID,
        provider: "local",
        tier: "local-gpu",
        totalCapacity: 500000,
        sharedCapacity: 500000,
        active: true,
        created: NOW,
      });
      expect(result.provider).toBe("local");
      expect(result.monthlyCost).toBeUndefined();
    });
  });

  // ── OrgBudget ──

  describe("OrgBudget", () => {
    it("should parse a valid budget", () => {
      const result = OrgBudget.parse({
        id: ulid(),
        orgId: ORG_DID,
        state: "active",
        totalCredits: 100000,
        allocatedCredits: 80000,
        unallocatedCredits: 20000,
        consumedCredits: 45000,
        fiscalPeriod: {
          year: 2026,
          quarter: 1,
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-03-31T23:59:59Z",
        },
        fundingMethod: "direct-purchase",
        fundingSources: [
          { type: "purchased", amount: 100000, provider: "anthropic" },
        ],
        approvedBy: ORG_DID,
        approvedAt: NOW,
        created: NOW,
        updated: NOW,
        signature: SIG,
      });
      expect(result.totalCredits).toBe(100000);
      expect(result.state).toBe("active");
    });
  });

  // ── OrgMember ──

  describe("OrgMember", () => {
    it("should parse a member with budgetGroup", () => {
      const result = OrgMember.parse({
        id: ulid(),
        orgId: ORG_DID,
        employeeDid: EMPLOYEE_DID,
        role: "employee",
        status: "active",
        title: "Senior Engineer",
        budgetGroup: "engineering",
        startDate: "2026-01-15T00:00:00Z",
        created: NOW,
        updated: NOW,
      });
      expect(result.budgetGroup).toBe("engineering");
      expect(result.compensationPackage).toBeUndefined();
    });

    it("should parse a member without budgetGroup (flat)", () => {
      const result = OrgMember.parse({
        id: ulid(),
        orgId: ORG_DID,
        employeeDid: EMPLOYEE_DID,
        role: "contractor",
        status: "contractor",
        startDate: NOW,
        created: NOW,
        updated: NOW,
      });
      expect(result.budgetGroup).toBeUndefined();
    });
  });

  // ── OrgPolicy ──

  describe("OrgPolicy", () => {
    it("should parse a complete policy", () => {
      const result = OrgPolicy.parse({
        defaultVestingSchedule: "linear",
        defaultVestingConfig: {
          schedule: "linear",
          totalDuration: "P1Y",
          vestingInterval: "P1M",
        },
        maxAllocationPerEmployee: 200000,
        minAllocationPerEmployee: 50000,
        defaultOperationalConstraints: {
          allowedProviders: ["anthropic", "openai"],
          appliesDuring: "employment",
        },
        defaultEconomicConstraints: {
          allowCapacitySharing: false,
          transferablePreVesting: false,
        },
        allowPersonalUse: true,
        personalUsePercent: 0.1,
        allowExternalSharing: false,
        vestedCreditsOnTermination: "keep",
        unvestedCreditsOnTermination: "forfeit",
        terminationGracePeriod: "P90D",
        forCauseClawback: true,
        forCauseClawbackPercent: 0.5,
        reportingFrequency: "monthly",
        unusedCreditsRollover: true,
        maxRolloverPercent: 0.25,
      });
      expect(result.vestedCreditsOnTermination).toBe("keep");
      expect(result.unvestedCreditsOnTermination).toBe("forfeit");
    });

    it("should reject non-forfeit unvested termination policy", () => {
      expect(() =>
        OrgPolicy.parse({
          defaultVestingSchedule: "immediate",
          defaultVestingConfig: { schedule: "immediate" },
          allowPersonalUse: false,
          allowExternalSharing: false,
          vestedCreditsOnTermination: "keep",
          unvestedCreditsOnTermination: "keep", // must be "forfeit"
          forCauseClawback: false,
          reportingFrequency: "quarterly",
          unusedCreditsRollover: false,
        }),
      ).toThrow();
    });
  });

  // ── Organization ──

  describe("Organization", () => {
    it("should parse a minimal organization", () => {
      const result = Organization.parse({
        id: ORG_DID,
        name: "Acme Corp",
        publicKey: "test-public-key",
        capacitySources: [],
        policies: {
          defaultVestingSchedule: "immediate",
          defaultVestingConfig: { schedule: "immediate" },
          allowPersonalUse: false,
          allowExternalSharing: false,
          vestedCreditsOnTermination: "keep",
          unvestedCreditsOnTermination: "forfeit",
          forCauseClawback: false,
          reportingFrequency: "monthly",
          unusedCreditsRollover: false,
        },
        members: [],
        created: NOW,
        updated: NOW,
        signature: SIG,
      });
      expect(result.name).toBe("Acme Corp");
      expect(result.members).toHaveLength(0);
    });
  });

  // ── Employer Messages ──

  describe("Employer Message Payloads", () => {
    it("should parse BUDGET_CREATE message", () => {
      const result = MessagePayload.parse({
        type: "BUDGET_CREATE",
        budget: {
          id: ulid(),
          orgId: ORG_DID,
          state: "draft",
          totalCredits: 100000,
          allocatedCredits: 0,
          unallocatedCredits: 100000,
          consumedCredits: 0,
          fiscalPeriod: {
            year: 2026,
            quarter: 2,
            startDate: "2026-04-01T00:00:00Z",
            endDate: "2026-06-30T23:59:59Z",
          },
          fundingMethod: "direct-purchase",
          fundingSources: [{ type: "purchased", amount: 100000 }],
          created: NOW,
          updated: NOW,
          signature: SIG,
        },
      });
      expect(result.type).toBe("BUDGET_CREATE");
    });

    it("should parse BUDGET_ALLOCATE message", () => {
      const result = MessagePayload.parse({
        type: "BUDGET_ALLOCATE",
        fromBudget: ulid(),
        toEmployee: EMPLOYEE_DID,
        amount: 10000,
        budgetGroup: "ml-team",
        approver: ORG_DID,
        delegationProof: "ucan-token-string",
      });
      expect(result.type).toBe("BUDGET_ALLOCATE");
    });

    it("should parse BUDGET_WARNING message", () => {
      const result = MessagePayload.parse({
        type: "BUDGET_WARNING",
        budgetId: ulid(),
        warningType: "threshold-reached",
        threshold: 0.8,
        currentUsage: 80000,
        totalBudget: 100000,
        message: "Budget is 80% consumed",
        timestamp: NOW,
      });
      expect(result.type).toBe("BUDGET_WARNING");
    });

    it("should parse ORG_USAGE_REPORT message", () => {
      const result = MessagePayload.parse({
        type: "ORG_USAGE_REPORT",
        orgId: ORG_DID,
        period: {
          year: 2026,
          quarter: 1,
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-03-31T23:59:59Z",
        },
        summary: {
          totalBudget: 100000,
          totalAllocated: 80000,
          totalConsumed: 45000,
          utilizationRate: 0.5625,
          memberCount: 10,
          avgPerMember: 4500,
        },
        byBudgetGroup: [
          {
            group: "engineering",
            allocated: 60000,
            consumed: 35000,
            utilizationRate: 0.583,
            headcount: 6,
          },
        ],
        byProvider: [
          { provider: "anthropic", creditsConsumed: 40000 },
        ],
        topConsumers: [
          { employeeDid: EMPLOYEE_DID, creditsUsed: 8000, topDomains: ["code-generation"] },
        ],
        timestamp: NOW,
        signature: SIG,
      });
      expect(result.type).toBe("ORG_USAGE_REPORT");
    });
  });
});
