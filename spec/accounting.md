# ALXP Accounting — Valuation, Tax Events & Financial Reporting

> **Status:** Draft v0.1
> **Date:** 2026-03-12
> **Depends on:** object-model, compensation, employer-model, exchange, messages

## 1. Overview

This specification defines how compute credits are valued in fiat terms, how taxable events are recorded, and how compensation reports are generated for financial and regulatory compliance. It provides the data shapes that platforms export to payroll systems, tax filing software, and financial planning tools.

Compute-as-compensation creates a new category of non-cash compensation that must be valued, reported, and audited. The protocol does not perform tax calculations — it provides the signed, auditable data that tax systems consume.

### The Valuation Problem

Compute credits do not have an inherent fiat value. Unlike publicly traded stock, there is no market price to reference. The protocol addresses this by defining multiple valuation methods ordered by current availability:

1. **Cost-basis** and **provider-list-price** are available today. If an org pays $25,000/month for 500,000 credits, the cost-basis is $0.05/credit. If Anthropic charges $0.003/input token and a credit represents ~1,000 tokens, the list price is $3.00/credit.
2. **Market-rate** and **fair-market-value** will become available when a liquid credit market exists. Until then, these methods are defined but not yet practical.

This ordering means early adopters have a clear path: use cost-basis today, transition to market-rate when it emerges.

### Design Principles

1. **Valuation methods ordered by availability** — Cost-basis and provider-list-price work now. Market-rate and FMV require a liquid market.
2. **Transparent audit trail** — Every valuation includes its inputs (provider rates, cost data, market data) so auditors can verify how a fiat value was computed.
3. **Protocol defines shapes, not tax law** — The protocol provides `W2SupplementalData` and `Form1099MiscData` as export shapes. It does not calculate withholding, determine tax brackets, or enforce jurisdiction-specific rules.
4. **Signed everything** — Valuation records, tax events, and reports are all cryptographically signed for non-repudiation.

---

## 2. Valuation Methods

### 2.1 Method Definitions

| Method | Availability | Description |
|--------|-------------|-------------|
| `cost-basis` | **Now** | Credits valued at the organization's acquisition cost. If the org pays $25,000/month for 500,000 credits, each credit costs $0.05. |
| `provider-list-price` | **Now** | Credits valued at the provider's published API pricing. Map credit consumption to token counts and apply the provider's per-token rates. |
| `weighted-average` | **Now** | Weighted combination of multiple methods. Useful when an org has multiple capacity sources at different costs. |
| `market-rate` | Future | Credits valued at the prevailing exchange rate on a credit marketplace. Requires a liquid trading venue. |
| `fair-market-value` | Future | Independent appraisal of credit value, analogous to 409A valuations for private stock. |
| `custom` | Now | Platform-specific method with documented rationale. |

### 2.2 When to Use Each Method

| Scenario | Recommended Method | Rationale |
|----------|--------------------|-----------|
| Single provider, known contract cost | `cost-basis` | Direct, auditable, matches what the org actually pays |
| Multi-provider, varying rates | `weighted-average` | Reflects blended cost across sources |
| Employee wants to understand market value | `provider-list-price` | Maps to public pricing employees can verify |
| Credit trading exists | `market-rate` | Market price is the most objective measure |
| Tax reporting (no market) | `cost-basis` | Most defensible for tax purposes when no market exists |
| Tax reporting (liquid market) | `fair-market-value` | Standard for non-cash compensation with a measurable value |

---

## 3. Valuation Inputs

Every valuation carries its inputs for transparency and auditability:

```
ValuationInputs {
  providerRates: [{                         // provider API pricing data
    provider:           SubscriptionProvider
    model:              string?
    inputTokenRate:     number?             // cost per input token
    outputTokenRate:    number?             // cost per output token
    effectiveDate:      ISO8601
    source:             string              // e.g., "anthropic.com/pricing"
  }]?

  marketData: {                             // credit market data (future)
    exchangeRate:       number
    volume24h:          number?
    source:             string              // e.g., "alxp-exchange.com"
    sampleDate:         ISO8601
  }?

  costBasis: {                              // org's actual costs
    totalCost:          number
    totalCredits:       number
    costPerCredit:      number
    sourceContract:     string?             // contract reference
  }?

  weights: [{                               // for weighted-average method
    method:             ValuationMethod
    weight:             number (0–1)
    value:              number              // value per credit from this method
  }]?
}
```

### Example: Cost-Basis Valuation

```json
{
  "costBasis": {
    "totalCost": 25000,
    "totalCredits": 500000,
    "costPerCredit": 0.05,
    "sourceContract": "ACME-ANTHROPIC-2026-001"
  }
}
```

### Example: Weighted-Average Valuation

An org with both Anthropic Enterprise ($0.05/credit) and OpenAI Team ($0.08/credit), weighted by usage:

```json
{
  "weights": [
    { "method": "cost-basis", "weight": 0.7, "value": 0.05 },
    { "method": "cost-basis", "weight": 0.3, "value": 0.08 }
  ],
  "costBasis": {
    "totalCost": 31000,
    "totalCredits": 500000,
    "costPerCredit": 0.062
  }
}
```

---

## 4. Valuation Record

A point-in-time valuation of compute credits, signed for non-repudiation:

```
ValuationRecord {
  id:                   ULID
  timestamp:            ISO8601

  creditAmount:         number              // credits being valued
  creditTransactionId:  ULID?               // linked transaction (vesting event, grant)

  fiatValue:            FiatValuation       // resulting fiat value
  valuationMethod:      ValuationMethod     // which method was used
  valuationInputs:      ValuationInputs     // all inputs (for audit)

  allocationId:         ULID?               // linked allocation
  employeeDid:          DID?
  employerDid:          DID?
  jurisdiction:         string?             // tax jurisdiction

  computedBy:           DID                 // who computed this valuation
  signature:            Signature
}
```

Valuation records are created at key moments:
- When a `comp-grant` transaction occurs (initial grant valuation)
- When a `comp-vest` event occurs (vesting-date valuation for tax purposes)
- When a `comp-forfeit` or `comp-clawback` occurs (reversal valuation)
- At period boundaries for reporting

---

## 5. Tax Events

A `TaxEvent` records a moment when compute compensation creates a taxable obligation:

```
TaxEvent {
  id:                   ULID
  type:                 TaxEventType
  timestamp:            ISO8601

  employee:             DID
  employer:             DID

  creditAmount:         number              // credits involved
  fiatValue:            FiatValuation       // value at the time of the event
  valuationRecordId:    ULID                // link to the full valuation

  allocationId:         ULID
  compensationType:     CompensationType
  transactionId:        ULID?               // linked credit transaction

  jurisdiction:         string
  taxYear:              number
  taxQuarter:           number? (1–4)

  description:          string
  signature:            Signature
}
```

### 5.1 Tax Event Types

| Type | Trigger | Taxable Amount |
|------|---------|----------------|
| `comp-income` | `comp-grant` with `immediate` vesting | Full grant value at grant date |
| `vest-event` | `comp-vest` transaction | Value of newly vested credits at vesting date |
| `usage-benefit` | Employee uses credits for personal tasks | Value of credits consumed |
| `forfeit-reversal` | `comp-forfeit` of previously taxed credits | Negative adjustment (credit back) |
| `clawback-adjustment` | `comp-clawback` of vested credits | Negative adjustment |
| `sharing-income` | Employee earns credits by sharing allocated capacity | Value of credits earned |

### 5.2 Timing

The taxable moment depends on the event type:

| Event | Taxable When |
|-------|-------------|
| Immediate-vesting grant | At grant date |
| Cliff/linear/back-loaded vesting | At each vesting event |
| Milestone vesting | When milestone is completed |
| Usage | When credits are consumed |
| Forfeiture | When forfeiture occurs (reversal of prior income) |

This mirrors the tax treatment of restricted stock units (RSUs): the taxable event occurs at vesting, not at grant, unless vesting is immediate.

---

## 6. Compensation Reports

### 6.1 Report Types

| Type | Purpose |
|------|---------|
| `w2-supplemental` | W-2 supplemental data for US employees |
| `1099-misc` | 1099-MISC data for US contractors |
| `annual-comp-summary` | Annual compensation summary for the individual |
| `quarterly-usage` | Quarterly usage and valuation report |
| `audit-trail` | Complete audit trail of all compensation events |
| `cost-center` | Cost center allocation for financial planning |
| `custom` | Platform-specific report |

### 6.2 Compensation Report

The `CompensationReport` aggregates tax events and valuations for a reporting period:

```
CompensationReport {
  id:                 ULID
  type:               ReportType
  perspective:        "employer" | "employee"

  period: {
    startDate:        ISO8601
    endDate:          ISO8601
    taxYear:          number
    label:            string            // e.g., "FY2026"
  }

  employeeDid:        DID?              // absent for org-level reports
  employerDid:        DID
  jurisdiction:       string

  summary: {
    totalCompGranted:   number          // credits granted in period
    totalCompVested:    number          // credits vested in period
    totalCompUsed:      number          // credits consumed in period
    totalFiatValue:     FiatValuation   // total fiat value of compensation
    totalForfeited:     number          // credits forfeited in period
    netTaxableValue:    FiatValuation   // net taxable value (grants - forfeitures)
  }

  taxEvents:          TaxEvent[]        // all taxable events in period
  valuationRecords:   ValuationRecord[] // all valuations in period
  transactionIds:     ULID[]            // all credit transactions in period

  workforceSummary: {                   // present for employer-perspective reports
    employeeCount:      number
    totalCompExpense:   FiatValuation
    avgPerEmployee:     FiatValuation
    byBudgetGroup: [{
      group:            string
      totalExpense:     FiatValuation
      headcount:        number
    }]
  }?

  generated:          ISO8601
  signature:          Signature
}
```

### 6.3 Employer vs. Employee Perspective

**Employee perspective** (`perspective: "employee"`): Shows the individual's compensation events, vesting, and tax obligations. `employeeDid` is set, `workforceSummary` is absent.

**Employer perspective** (`perspective: "employer"`): Shows aggregate compensation across the workforce. `employeeDid` may be absent (org-level) or present (per-employee breakdown). `workforceSummary` provides budget group rollups.

---

## 7. Cost Center Records

A `CostCenterRecord` maps compute consumption to organizational cost centers for financial planning:

```
CostCenterRecord {
  id:                 ULID
  orgId:              DID
  costCenter:         string            // cost center code
  costCenterName:     string            // human-readable name
  period:             CompensationPeriod

  creditsConsumed:    number
  fiatCost:           FiatValuation

  byEmployee: [{
    employeeDid:      DID
    creditsUsed:      number
    cost:             FiatValuation
  }]

  byProvider: [{
    provider:         SubscriptionProvider
    creditsUsed:      number
    cost:             FiatValuation
  }]

  byDomain: [{
    domain:           string
    creditsUsed:      number
    cost:             FiatValuation
  }]

  timestamp:          ISO8601
  signature:          Signature
}
```

Cost centers map naturally to the employer model's `budgetGroup` tag. A platform that uses `budgetGroup` values like `engineering.backend` can generate cost center records with `costCenter: "engineering.backend"`.

The three breakdown dimensions (employee, provider, domain) answer the finance team's key questions:
- **By employee:** Who is consuming the most compute?
- **By provider:** Where is the money going?
- **By domain:** What type of work is driving costs?

---

## 8. Tax Export Shapes

### 8.1 W-2 Supplemental Data

For US employees, compute compensation appears as supplemental income on Form W-2:

```
W2SupplementalData {
  employeeName:         string
  employeeTIN:          string            // Tax Identification Number
  employerEIN:          string            // Employer Identification Number
  taxYear:              number
  computeCompensation:  number            // fiat value of compute comp
  description:          "AI Compute Compensation"
}
```

This is an **export shape** — a data structure that platforms map into their payroll system's W-2 supplemental income fields. The protocol defines the shape; the platform handles the actual W-2 filing.

### 8.2 Form 1099-MISC Data

For US contractors, compute compensation is reported on Form 1099-MISC:

```
Form1099MiscData {
  recipientName:        string
  recipientTIN:         string
  payerEIN:             string
  taxYear:              number
  nonemployeeComp:      number            // fiat value in Box 7
  description:          "AI Compute Compensation"
}
```

### 8.3 Tax Export Flow

```
CompensationReport (annual)
    │
    ├── Employee (role: "employee")
    │   └── Generate W2SupplementalData
    │       └── Export to payroll system
    │
    └── Contractor (role: "contractor")
        └── Generate Form1099MiscData
            └── Export to tax filing system
```

The `OrgMember.role` field determines which export shape applies. `employee` maps to W-2; `contractor` maps to 1099-MISC. Non-US jurisdictions use `custom` report types with jurisdiction-specific export shapes defined by the platform.

---

## 9. Retention Requirements

The `RetentionRequirement` marks how long compensation records must be retained:

```
RetentionRequirement {
  objectType:           string            // e.g., "TaxEvent", "ValuationRecord"
  minRetentionYears:    number            // minimum years to retain
  jurisdiction:         string            // e.g., "US", "EU"
  legalBasis:           string            // e.g., "IRS 26 CFR 1.6001-1"
}
```

This is advisory metadata — the protocol does not enforce retention. Platforms use these markers to configure their data lifecycle policies. Common retention periods:

| Object | US Retention | Basis |
|--------|-------------|-------|
| TaxEvent | 7 years | IRS record-keeping requirements |
| ValuationRecord | 7 years | Supports TaxEvent audit |
| CompensationReport | 7 years | Tax filing support |
| CostCenterRecord | 5 years | Financial planning records |
| CreditTransaction | 7 years | Settlement audit trail |

---

## 10. Protocol Messages

Three accounting message types:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `VALUATION_RECORD` | System -> Stakeholders | New valuation computed |
| `TAX_EVENT` | System -> Employee/Employer | Taxable event occurred |
| `REPORT_GENERATED` | System -> Stakeholders | Compensation report available |

### REPORT_GENERATED

The report generation message includes a summary so recipients can decide whether to download the full report:

```json
{
  "type": "REPORT_GENERATED",
  "reportId": "01JQERPT01...",
  "reportType": "annual-comp-summary",
  "period": { "year": 2026, "quarter": null, "startDate": "...", "endDate": "...", "label": "FY2026" },
  "summary": {
    "totalCompGranted": 200000,
    "totalCompVested": 50000,
    "totalCompUsed": 38000,
    "totalFiatValue": { "amount": 10000, "currency": "USD", "valuationMethod": "cost-basis", "effectiveDate": "..." },
    "totalForfeited": 0,
    "netTaxableValue": { "amount": 2500, "currency": "USD", "valuationMethod": "cost-basis", "effectiveDate": "..." }
  },
  "downloadUrl": "https://platform.example.com/reports/01JQERPT01..."
}
```

---

## 11. End-to-End Example

Alice's compute compensation accounting for tax year 2026:

```
1. January — Grant
   - COMP_ALLOCATE: 200,000 credits, 4-year cliff vesting
   - ValuationRecord: 200,000 credits @ $0.05 = $10,000 (cost-basis)
   - No TaxEvent yet (cliff vesting — taxable at vest, not grant)

2. Monthly — Usage
   - Alice uses ~4,000 credits/month on work tasks
   - No TaxEvent for work usage (employer-directed, not personal benefit)
   - CostCenterRecord updated: engineering.backend

3. January (Year 2) — Cliff Vests
   - COMP_VEST: 50,000 credits vest
   - ValuationRecord: 50,000 credits @ $0.06 = $3,000 (cost-basis, rate updated)
   - TaxEvent: type "vest-event", $3,000 taxable income
   - W2SupplementalData generated with $3,000 compute compensation

4. March — Personal Use
   - Alice uses 500 vested credits for a personal project
   - TaxEvent: type "usage-benefit", 500 credits @ $0.06 = $30
   - (Some jurisdictions may not tax this separately if already taxed at vest)

5. Year-End — Annual Report
   - CompensationReport (employee perspective):
     - totalCompGranted: 200,000
     - totalCompVested: 50,000
     - totalCompUsed: 48,000 (work) + 500 (personal)
     - totalFiatValue: $10,000 (full grant value)
     - netTaxableValue: $3,030 (vest event + usage benefit)
   - REPORT_GENERATED message sent to Alice

6. Year-End — Employer Report
   - CompensationReport (employer perspective):
     - workforceSummary: 85 employees, $425,000 total comp expense
     - byBudgetGroup: engineering ($280,000), marketing ($80,000), ...
   - CostCenterRecord: engineering.backend consumed 180,000 credits ($9,000)
```

---

## 12. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **compensation** | `FiatValuation` originates here. `CompensationType` determines tax treatment. `VestingConfig` schedule determines when `vest-event` tax events occur. |
| **employer-model** | `OrgCapacitySource.monthlyCost` and `costPerCredit` feed `ValuationInputs.costBasis`. `OrgMember.role` determines W-2 vs. 1099 export. `budgetGroup` maps to cost centers. |
| **sla** | SLA breach remediations (credit extensions) may create additional tax events. SLA reports are referenced in audit trails. |
| **exchange** | `CreditTransaction` records are the source data for valuation and tax event generation. `SubscriptionProvider` appears in provider rate inputs. |
| **identity** | All accounting objects are signed with Ed25519. `computedBy` DID on `ValuationRecord` identifies the valuation authority. |
| **messages** | `VALUATION_RECORD`, `TAX_EVENT`, and `REPORT_GENERATED` added to `MessagePayload`. |

---

## 13. What Stays Platform-Level

| Concern | Why Platform |
|---------|-------------|
| Tax calculation and withholding | Jurisdiction-specific, requires payroll integration |
| W-2 / 1099 filing | Requires payroll provider integration (ADP, Gusto, etc.) |
| FMV appraisals | Requires independent appraisal process |
| Credit market exchange rate | Requires a trading venue the protocol does not operate |
| International tax treaty handling | Complex jurisdiction-specific rules |
| Depreciation schedules for compute assets | Accounting policy, not protocol |
| ERP / GL integration | Platform maps protocol data to enterprise systems |
| Audit firm access and permissions | Platform access control |
