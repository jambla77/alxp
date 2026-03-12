import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import {
  CompensationType,
  VestingSchedule,
  AllocationState,
  OperationalConstraints,
  EconomicConstraints,
  VestingMilestone,
  VestingConfig,
  CompensationPeriod,
  FiatValuation,
  ComputeAllocation,
  CompensationPackage,
  MessagePayload,
  CreditTransactionType,
} from "../src/types/index.js";

const EMPLOYER_DID = "did:key:z6MkEmployer";
const EMPLOYEE_DID = "did:key:z6MkEmployee";
const NOW = new Date().toISOString();
const SIG = "test-signature-base64url";

describe("Compensation Layer Schemas", () => {
  // ── Enums ──

  describe("CompensationType", () => {
    it("should accept all valid types", () => {
      for (const t of [
        "salary-compute",
        "bonus-compute",
        "signing-compute",
        "retention-compute",
        "performance-compute",
        "project-compute",
      ]) {
        expect(CompensationType.parse(t)).toBe(t);
      }
    });

    it("should reject invalid types", () => {
      expect(() => CompensationType.parse("equity")).toThrow();
    });
  });

  describe("VestingSchedule", () => {
    it("should accept all valid schedules", () => {
      for (const s of ["immediate", "cliff", "linear", "back-loaded", "milestone"]) {
        expect(VestingSchedule.parse(s)).toBe(s);
      }
    });
  });

  describe("AllocationState", () => {
    it("should accept all valid states", () => {
      for (const s of [
        "pending",
        "active",
        "vesting",
        "fully-vested",
        "forfeited",
        "expired",
        "revoked",
      ]) {
        expect(AllocationState.parse(s)).toBe(s);
      }
    });
  });

  // ── Constraints ──

  describe("OperationalConstraints", () => {
    it("should parse minimal operational constraints", () => {
      const result = OperationalConstraints.parse({
        appliesDuring: "employment",
      });
      expect(result.appliesDuring).toBe("employment");
      expect(result.allowedProviders).toBeUndefined();
    });

    it("should parse full operational constraints", () => {
      const result = OperationalConstraints.parse({
        allowedProviders: ["anthropic", "openai"],
        blockedProviders: ["other"],
        allowedModels: ["claude-opus-4"],
        justification: "SOC 2 Type II required",
        complianceFrameworks: ["SOC2", "HIPAA"],
        dataResidency: ["US", "EU"],
        requireEncryption: true,
        maxCreditsPerDay: 500,
        maxCreditsPerTask: 100,
        appliesDuring: "employment-plus-grace",
        gracePeriod: "P90D",
      });
      expect(result.allowedProviders).toEqual(["anthropic", "openai"]);
      expect(result.complianceFrameworks).toEqual(["SOC2", "HIPAA"]);
      expect(result.appliesDuring).toBe("employment-plus-grace");
    });
  });

  describe("EconomicConstraints", () => {
    it("should parse with defaults", () => {
      const result = EconomicConstraints.parse({
        allowCapacitySharing: false,
        transferablePreVesting: false,
      });
      expect(result.survivesTermination).toBe(true); // default
      expect(result.allowCapacitySharing).toBe(false);
    });

    it("should allow overriding survivesTermination default", () => {
      const result = EconomicConstraints.parse({
        allowCapacitySharing: false,
        transferablePreVesting: false,
        survivesTermination: false,
      });
      expect(result.survivesTermination).toBe(false);
    });

    it("should parse full economic constraints", () => {
      const result = EconomicConstraints.parse({
        allowedDomains: ["code-generation", "translation"],
        restrictedDomains: ["image-generation"],
        allowCapacitySharing: true,
        sharingRevenueShare: 0.2,
        transferablePreVesting: false,
        survivesTermination: true,
        expiresAfterTermination: "P90D",
      });
      expect(result.allowedDomains).toEqual(["code-generation", "translation"]);
      expect(result.sharingRevenueShare).toBe(0.2);
    });
  });

  // ── Vesting ──

  describe("VestingConfig", () => {
    it("should parse immediate vesting", () => {
      const result = VestingConfig.parse({ schedule: "immediate" });
      expect(result.schedule).toBe("immediate");
    });

    it("should parse cliff vesting", () => {
      const result = VestingConfig.parse({
        schedule: "cliff",
        cliffDuration: "P1Y",
        cliffPercent: 0.25,
        postCliffSchedule: "monthly",
        postCliffDuration: "P3Y",
      });
      expect(result.schedule).toBe("cliff");
      if (result.schedule === "cliff") {
        expect(result.cliffPercent).toBe(0.25);
        expect(result.postCliffSchedule).toBe("monthly");
      }
    });

    it("should parse linear vesting", () => {
      const result = VestingConfig.parse({
        schedule: "linear",
        totalDuration: "P4Y",
        vestingInterval: "P1M",
      });
      expect(result.schedule).toBe("linear");
    });

    it("should parse back-loaded vesting", () => {
      const result = VestingConfig.parse({
        schedule: "back-loaded",
        totalDuration: "P4Y",
        yearlyPercents: [0.05, 0.15, 0.3, 0.5],
      });
      expect(result.schedule).toBe("back-loaded");
      if (result.schedule === "back-loaded") {
        expect(result.yearlyPercents).toHaveLength(4);
      }
    });

    it("should parse milestone vesting", () => {
      const result = VestingConfig.parse({
        schedule: "milestone",
        milestones: [
          {
            id: "m1",
            description: "Ship v1",
            percent: 0.5,
            deadline: NOW,
            completed: false,
          },
          {
            id: "m2",
            description: "100k users",
            percent: 0.5,
            completed: true,
            completedAt: NOW,
          },
        ],
      });
      expect(result.schedule).toBe("milestone");
      if (result.schedule === "milestone") {
        expect(result.milestones).toHaveLength(2);
      }
    });

    it("should reject cliff vesting without required fields", () => {
      expect(() =>
        VestingConfig.parse({
          schedule: "cliff",
          // missing cliffDuration and cliffPercent
        }),
      ).toThrow();
    });

    it("should reject invalid schedule type", () => {
      expect(() => VestingConfig.parse({ schedule: "quarterly" })).toThrow();
    });
  });

  // ── FiatValuation ──

  describe("FiatValuation", () => {
    it("should parse a valid valuation", () => {
      const result = FiatValuation.parse({
        amount: 96000,
        currency: "USD",
        valuationMethod: "provider-list-price",
        effectiveDate: NOW,
      });
      expect(result.amount).toBe(96000);
      expect(result.valuationMethod).toBe("provider-list-price");
    });
  });

  // ── ComputeAllocation ──

  describe("ComputeAllocation", () => {
    const baseAllocation = {
      id: ulid(),
      employer: EMPLOYER_DID,
      employee: EMPLOYEE_DID,
      type: "salary-compute" as const,
      state: "vesting" as const,
      totalCredits: 120000,
      vestedCredits: 30000,
      unvestedCredits: 90000,
      usedCredits: 18500,
      availableCredits: 11500,
      vestingSchedule: "linear" as const,
      vestingConfig: {
        schedule: "linear" as const,
        totalDuration: "P1Y",
        vestingInterval: "P1M",
      },
      vestingStartDate: NOW,
      created: NOW,
      updated: NOW,
      employerSignature: SIG,
    };

    it("should parse a minimal allocation", () => {
      const result = ComputeAllocation.parse(baseAllocation);
      expect(result.totalCredits).toBe(120000);
      expect(result.vestingSchedule).toBe("linear");
      expect(result.operationalConstraints).toBeUndefined();
      expect(result.economicConstraints).toBeUndefined();
    });

    it("should parse allocation with both constraint types", () => {
      const result = ComputeAllocation.parse({
        ...baseAllocation,
        operationalConstraints: {
          allowedProviders: ["anthropic"],
          justification: "SOC 2 compliance",
          complianceFrameworks: ["SOC2"],
          appliesDuring: "employment",
        },
        economicConstraints: {
          allowCapacitySharing: false,
          transferablePreVesting: false,
          survivesTermination: true,
          expiresAfterTermination: "P90D",
        },
      });
      expect(result.operationalConstraints?.allowedProviders).toEqual(["anthropic"]);
      expect(result.economicConstraints?.survivesTermination).toBe(true);
    });

    it("should parse allocation with immediate vesting", () => {
      const result = ComputeAllocation.parse({
        ...baseAllocation,
        type: "bonus-compute",
        state: "fully-vested",
        vestingSchedule: "immediate",
        vestingConfig: { schedule: "immediate" },
        vestedCredits: 120000,
        unvestedCredits: 0,
        availableCredits: 101500,
      });
      expect(result.state).toBe("fully-vested");
    });

    it("should reject negative credit amounts", () => {
      expect(() =>
        ComputeAllocation.parse({
          ...baseAllocation,
          totalCredits: -1,
        }),
      ).toThrow();
    });
  });

  // ── CompensationPackage ──

  describe("CompensationPackage", () => {
    it("should parse a complete package", () => {
      const allocation = ComputeAllocation.parse({
        id: ulid(),
        employer: EMPLOYER_DID,
        employee: EMPLOYEE_DID,
        type: "salary-compute",
        state: "vesting",
        totalCredits: 120000,
        vestedCredits: 30000,
        unvestedCredits: 90000,
        usedCredits: 18500,
        availableCredits: 11500,
        vestingSchedule: "linear",
        vestingConfig: { schedule: "linear", totalDuration: "P1Y", vestingInterval: "P1M" },
        vestingStartDate: NOW,
        created: NOW,
        updated: NOW,
        employerSignature: SIG,
      });

      const pkg = CompensationPackage.parse({
        id: ulid(),
        employer: EMPLOYER_DID,
        employee: EMPLOYEE_DID,
        allocations: [allocation],
        totalGranted: 120000,
        totalVested: 30000,
        totalUsed: 18500,
        totalAvailable: 11500,
        totalForfeited: 0,
        annualizedCredits: 120000,
        estimatedFiatValue: {
          amount: 96000,
          currency: "USD",
          valuationMethod: "provider-list-price",
          effectiveDate: NOW,
        },
        effectiveDate: NOW,
        updated: NOW,
        employerSignature: SIG,
      });

      expect(pkg.allocations).toHaveLength(1);
      expect(pkg.totalGranted).toBe(120000);
      expect(pkg.estimatedFiatValue?.amount).toBe(96000);
    });
  });

  // ── Credit Transaction Types ──

  describe("CreditTransactionType (compensation extensions)", () => {
    it("should accept compensation transaction types", () => {
      for (const t of ["comp-grant", "comp-vest", "comp-forfeit", "comp-clawback", "comp-expire"]) {
        expect(CreditTransactionType.parse(t)).toBe(t);
      }
    });

    it("should still accept original transaction types", () => {
      for (const t of ["earn", "spend", "escrow", "release", "refund"]) {
        expect(CreditTransactionType.parse(t)).toBe(t);
      }
    });
  });

  // ── Compensation Messages ──

  describe("Compensation Message Payloads", () => {
    it("should parse COMP_ALLOCATE message", () => {
      const result = MessagePayload.parse({
        type: "COMP_ALLOCATE",
        allocation: {
          id: ulid(),
          employer: EMPLOYER_DID,
          employee: EMPLOYEE_DID,
          type: "salary-compute",
          state: "pending",
          totalCredits: 120000,
          vestedCredits: 0,
          unvestedCredits: 120000,
          usedCredits: 0,
          availableCredits: 0,
          vestingSchedule: "linear",
          vestingConfig: { schedule: "linear", totalDuration: "P1Y", vestingInterval: "P1M" },
          vestingStartDate: NOW,
          created: NOW,
          updated: NOW,
          employerSignature: SIG,
        },
      });
      expect(result.type).toBe("COMP_ALLOCATE");
    });

    it("should parse COMP_VEST message", () => {
      const result = MessagePayload.parse({
        type: "COMP_VEST",
        allocationId: ulid(),
        employee: EMPLOYEE_DID,
        amountVested: 10000,
        totalVestedAfter: 40000,
        vestingEvent: NOW,
        nextVestingEvent: NOW,
      });
      expect(result.type).toBe("COMP_VEST");
    });

    it("should parse COMP_FORFEIT message", () => {
      const result = MessagePayload.parse({
        type: "COMP_FORFEIT",
        allocationId: ulid(),
        employee: EMPLOYEE_DID,
        amountForfeited: 90000,
        reason: "termination",
        effectiveDate: NOW,
      });
      expect(result.type).toBe("COMP_FORFEIT");
    });

    it("should parse COMP_USAGE_REPORT message", () => {
      const result = MessagePayload.parse({
        type: "COMP_USAGE_REPORT",
        employee: EMPLOYEE_DID,
        employer: EMPLOYER_DID,
        period: {
          year: 2026,
          quarter: 1,
          label: "Q1 2026",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-03-31T23:59:59Z",
        },
        allocations: [
          {
            allocationId: ulid(),
            creditsUsed: 18500,
            creditsRemaining: 11500,
            topDomains: [{ domain: "code-generation", credits: 12000 }],
            topProviders: [{ provider: "anthropic", credits: 18500 }],
          },
        ],
        totalUsed: 18500,
        totalRemaining: 11500,
        timestamp: NOW,
        signature: SIG,
      });
      expect(result.type).toBe("COMP_USAGE_REPORT");
    });
  });
});
