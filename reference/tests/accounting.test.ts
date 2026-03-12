import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import {
  ValuationMethod,
  TaxEventType,
  ReportType,
  ValuationInputs,
  ValuationRecord,
  TaxEvent,
  CompensationReport,
  CostCenterRecord,
  RetentionRequirement,
  W2SupplementalData,
  Form1099MiscData,
  MessagePayload,
} from "../src/types/index.js";

const ORG_DID = "did:key:z6MkOrg";
const EMPLOYEE_DID = "did:key:z6MkEmployee";
const VALUER_DID = "did:key:z6MkValuer";
const NOW = new Date().toISOString();
const SIG = "test-signature-base64url";

describe("Accounting Layer Schemas", () => {
  // ── Enums ──

  describe("ValuationMethod", () => {
    it("should accept all methods in priority order", () => {
      const methods = [
        "cost-basis",
        "provider-list-price",
        "weighted-average",
        "market-rate",
        "fair-market-value",
        "custom",
      ];
      for (const m of methods) {
        expect(ValuationMethod.parse(m)).toBe(m);
      }
    });
  });

  describe("TaxEventType", () => {
    it("should accept all tax event types", () => {
      for (const t of [
        "comp-income",
        "vest-event",
        "usage-benefit",
        "forfeit-reversal",
        "clawback-adjustment",
        "sharing-income",
      ]) {
        expect(TaxEventType.parse(t)).toBe(t);
      }
    });
  });

  describe("ReportType", () => {
    it("should accept all report types", () => {
      for (const t of [
        "w2-supplemental",
        "1099-misc",
        "annual-comp-summary",
        "quarterly-usage",
        "audit-trail",
        "cost-center",
        "custom",
      ]) {
        expect(ReportType.parse(t)).toBe(t);
      }
    });
  });

  // ── ValuationInputs ──

  describe("ValuationInputs", () => {
    it("should parse cost-basis inputs", () => {
      const result = ValuationInputs.parse({
        costBasis: {
          totalCost: 50000,
          totalCredits: 1000000,
          costPerCredit: 0.05,
          sourceContract: "ENT-2026-001",
        },
      });
      expect(result.costBasis?.costPerCredit).toBe(0.05);
    });

    it("should parse provider-rate inputs", () => {
      const result = ValuationInputs.parse({
        providerRates: [
          {
            provider: "anthropic",
            model: "claude-opus-4",
            inputTokenRate: 0.000015,
            outputTokenRate: 0.000075,
            effectiveDate: NOW,
            source: "https://anthropic.com/pricing",
          },
        ],
      });
      expect(result.providerRates).toHaveLength(1);
    });

    it("should parse weighted-average inputs", () => {
      const result = ValuationInputs.parse({
        weights: [
          { method: "cost-basis", weight: 0.6, value: 0.05 },
          { method: "provider-list-price", weight: 0.4, value: 0.08 },
        ],
      });
      expect(result.weights).toHaveLength(2);
    });

    it("should parse empty inputs", () => {
      const result = ValuationInputs.parse({});
      expect(result.costBasis).toBeUndefined();
      expect(result.providerRates).toBeUndefined();
    });
  });

  // ── ValuationRecord ──

  describe("ValuationRecord", () => {
    it("should parse a valid valuation record", () => {
      const result = ValuationRecord.parse({
        id: ulid(),
        timestamp: NOW,
        creditAmount: 10000,
        fiatValue: {
          amount: 500,
          currency: "USD",
          valuationMethod: "cost-basis",
          effectiveDate: NOW,
        },
        valuationMethod: "cost-basis",
        valuationInputs: {
          costBasis: {
            totalCost: 50000,
            totalCredits: 1000000,
            costPerCredit: 0.05,
          },
        },
        allocationId: ulid(),
        employeeDid: EMPLOYEE_DID,
        employerDid: ORG_DID,
        jurisdiction: "US",
        computedBy: VALUER_DID,
        signature: SIG,
      });
      expect(result.creditAmount).toBe(10000);
      expect(result.fiatValue.amount).toBe(500);
      expect(result.jurisdiction).toBe("US");
    });
  });

  // ── TaxEvent ──

  describe("TaxEvent", () => {
    it("should parse a vest tax event", () => {
      const result = TaxEvent.parse({
        id: ulid(),
        type: "vest-event",
        timestamp: NOW,
        employee: EMPLOYEE_DID,
        employer: ORG_DID,
        creditAmount: 10000,
        fiatValue: {
          amount: 800,
          currency: "USD",
          valuationMethod: "provider-list-price",
          effectiveDate: NOW,
        },
        valuationRecordId: ulid(),
        allocationId: ulid(),
        compensationType: "salary-compute",
        jurisdiction: "US",
        taxYear: 2026,
        taxQuarter: 1,
        description: "Monthly vesting of salary-compute allocation",
        signature: SIG,
      });
      expect(result.type).toBe("vest-event");
      expect(result.taxYear).toBe(2026);
    });

    it("should parse a forfeit-reversal event", () => {
      const result = TaxEvent.parse({
        id: ulid(),
        type: "forfeit-reversal",
        timestamp: NOW,
        employee: EMPLOYEE_DID,
        employer: ORG_DID,
        creditAmount: -5000,
        fiatValue: {
          amount: -400,
          currency: "USD",
          valuationMethod: "cost-basis",
          effectiveDate: NOW,
        },
        valuationRecordId: ulid(),
        allocationId: ulid(),
        compensationType: "retention-compute",
        jurisdiction: "US",
        taxYear: 2026,
        description: "Reversal of previously recognized income on forfeit",
        signature: SIG,
      });
      expect(result.creditAmount).toBe(-5000);
    });
  });

  // ── CostCenterRecord ──

  describe("CostCenterRecord", () => {
    it("should parse a cost center record", () => {
      const result = CostCenterRecord.parse({
        id: ulid(),
        orgId: ORG_DID,
        costCenter: "ENG-001",
        costCenterName: "Platform Engineering",
        period: {
          year: 2026,
          quarter: 1,
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-03-31T23:59:59Z",
        },
        creditsConsumed: 35000,
        fiatCost: {
          amount: 1750,
          currency: "USD",
          valuationMethod: "cost-basis",
          effectiveDate: NOW,
        },
        byEmployee: [
          {
            employeeDid: EMPLOYEE_DID,
            creditsUsed: 8000,
            cost: { amount: 400, currency: "USD", valuationMethod: "cost-basis", effectiveDate: NOW },
          },
        ],
        byProvider: [
          {
            provider: "anthropic",
            creditsUsed: 30000,
            cost: { amount: 1500, currency: "USD", valuationMethod: "cost-basis", effectiveDate: NOW },
          },
        ],
        byDomain: [
          {
            domain: "code-generation",
            creditsUsed: 25000,
            cost: { amount: 1250, currency: "USD", valuationMethod: "cost-basis", effectiveDate: NOW },
          },
        ],
        timestamp: NOW,
        signature: SIG,
      });
      expect(result.costCenter).toBe("ENG-001");
      expect(result.byEmployee).toHaveLength(1);
    });
  });

  // ── Export Shapes ──

  describe("Tax Export Shapes", () => {
    it("should parse W-2 supplemental data", () => {
      const result = W2SupplementalData.parse({
        employeeName: "Alice Engineer",
        employeeTIN: "encrypted-tin",
        employerEIN: "12-3456789",
        taxYear: 2026,
        computeCompensation: 96000,
        description: "AI Compute Compensation",
      });
      expect(result.computeCompensation).toBe(96000);
    });

    it("should reject wrong description literal", () => {
      expect(() =>
        W2SupplementalData.parse({
          employeeName: "Alice",
          employeeTIN: "tin",
          employerEIN: "ein",
          taxYear: 2026,
          computeCompensation: 50000,
          description: "Some other thing",
        }),
      ).toThrow();
    });

    it("should parse 1099-MISC data", () => {
      const result = Form1099MiscData.parse({
        recipientName: "Bob Contractor",
        recipientTIN: "encrypted-tin",
        payerEIN: "12-3456789",
        taxYear: 2026,
        nonemployeeComp: 45000,
        description: "AI Compute Compensation",
      });
      expect(result.nonemployeeComp).toBe(45000);
    });
  });

  // ── RetentionRequirement ──

  describe("RetentionRequirement", () => {
    it("should parse a retention requirement", () => {
      const result = RetentionRequirement.parse({
        objectType: "ValuationRecord",
        minRetentionYears: 7,
        jurisdiction: "US",
        legalBasis: "IRS 4-year retention for W-2 plus 3-year buffer",
      });
      expect(result.minRetentionYears).toBe(7);
    });
  });

  // ── Accounting Messages ──

  describe("Accounting Message Payloads", () => {
    it("should parse VALUATION_RECORD message", () => {
      const result = MessagePayload.parse({
        type: "VALUATION_RECORD",
        record: {
          id: ulid(),
          timestamp: NOW,
          creditAmount: 10000,
          fiatValue: {
            amount: 500,
            currency: "USD",
            valuationMethod: "cost-basis",
            effectiveDate: NOW,
          },
          valuationMethod: "cost-basis",
          valuationInputs: {
            costBasis: {
              totalCost: 50000,
              totalCredits: 1000000,
              costPerCredit: 0.05,
            },
          },
          computedBy: VALUER_DID,
          signature: SIG,
        },
      });
      expect(result.type).toBe("VALUATION_RECORD");
    });

    it("should parse TAX_EVENT message", () => {
      const result = MessagePayload.parse({
        type: "TAX_EVENT",
        event: {
          id: ulid(),
          type: "comp-income",
          timestamp: NOW,
          employee: EMPLOYEE_DID,
          employer: ORG_DID,
          creditAmount: 120000,
          fiatValue: {
            amount: 96000,
            currency: "USD",
            valuationMethod: "provider-list-price",
            effectiveDate: NOW,
          },
          valuationRecordId: ulid(),
          allocationId: ulid(),
          compensationType: "salary-compute",
          jurisdiction: "US",
          taxYear: 2026,
          description: "Immediate-vest salary-compute grant",
          signature: SIG,
        },
      });
      expect(result.type).toBe("TAX_EVENT");
    });

    it("should parse REPORT_GENERATED message", () => {
      const result = MessagePayload.parse({
        type: "REPORT_GENERATED",
        reportId: ulid(),
        reportType: "annual-comp-summary",
        period: {
          year: 2026,
          label: "FY 2026",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-12-31T23:59:59Z",
        },
        summary: {
          totalCompGranted: 500000,
          totalCompVested: 250000,
          totalCompUsed: 180000,
          totalFiatValue: {
            amount: 40000,
            currency: "USD",
            valuationMethod: "cost-basis",
            effectiveDate: NOW,
          },
          totalForfeited: 10000,
          netTaxableValue: {
            amount: 39200,
            currency: "USD",
            valuationMethod: "cost-basis",
            effectiveDate: NOW,
          },
        },
      });
      expect(result.type).toBe("REPORT_GENERATED");
    });
  });
});
