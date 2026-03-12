# ALXP Compensation — Compute-as-Compensation

> **Status:** Draft v0.1
> **Date:** 2026-03-12
> **Depends on:** object-model, exchange, identity, messages

## 1. Overview

This specification defines how organizations compensate individuals with compute credits — allocations of capacity that vest over time, carry operational and economic constraints, and ultimately convert into freely usable credits within the ALXP network.

Compute compensation is the analog of equity or stock grants in the AI agent economy. An employer purchases or pools subscription capacity, then allocates it to employees as part of a compensation package. The allocated credits vest according to a schedule, and once vested, become the employee's portable property — usable across the network without employer-imposed economic restrictions.

### Why Compute-as-Compensation

1. **AI subscriptions are the new benefit.** Organizations already purchase AI capacity for employees. ALXP formalizes this into a structured compensation framework with vesting, constraints, and accounting.
2. **Portability matters.** Vested compute credits should not be company scrip. The constraint model ensures that once credits vest, the employee can use them freely — including after leaving the organization.
3. **Auditability.** Every allocation is signed, every vesting event is a protocol message, and every usage is metered. This provides the audit trail that finance, compliance, and tax reporting require.

### Design Principles

1. **Operational vs. economic constraint split** — Constraints are divided by purpose, not by vesting status. Operational constraints (security, compliance) persist during employment. Economic constraints (portability, domain restrictions) drop at vesting.
2. **Vesting unlocks portability, not access** — Unvested credits are still usable within the employer's constraints. Vesting removes the economic restrictions, making credits fully portable.
3. **Protocol defines shapes, not policy** — The protocol specifies the data structures for allocations, vesting, and constraints. Organizational policies (who gets how much, when vesting accelerates) are platform concerns configured via `OrgPolicy`.

---

## 2. Compensation Types

Every compute allocation has a type that describes its purpose within the compensation package:

| Type | Description | Typical Vesting |
|------|-------------|-----------------|
| `salary-compute` | Recurring allocation tied to employment — the base compute component of compensation | Linear or monthly |
| `bonus-compute` | Performance-based one-time grant | Immediate or cliff |
| `signing-compute` | One-time grant at hire to attract talent | Cliff (commonly 1 year) |
| `retention-compute` | Grant tied to continued employment — typically back-loaded | Back-loaded |
| `performance-compute` | Grant tied to measurable performance outcomes | Milestone |
| `project-compute` | Scoped to a specific project — forfeited if the project ends early | Milestone or linear |

These types are informational at the protocol level. Platforms may use them to drive policy decisions (e.g., different tax treatment for `bonus-compute` vs. `salary-compute`).

---

## 3. Allocation States

A `ComputeAllocation` moves through a lifecycle:

```
pending ──> active ──> vesting ──> fully-vested
                │          │
                │          └──> forfeited
                │          └──> expired
                └──> revoked
```

| State | Meaning |
|-------|---------|
| `pending` | Allocation created but not yet countersigned by the employee |
| `active` | Both parties have signed; credits are available subject to constraints |
| `vesting` | Credits are partially vested; vesting events occur on schedule |
| `fully-vested` | All credits have vested; economic constraints have been dropped |
| `forfeited` | Unvested credits were forfeited (termination, expiration, or policy) |
| `expired` | Allocation reached its end date without full vesting |
| `revoked` | Employer revoked the allocation (for-cause scenarios) |

---

## 4. Constraints

Constraints are the mechanism that prevents compute compensation from becoming company scrip while still allowing employers to enforce legitimate security and compliance requirements.

### 4.1 Operational Constraints

Operational constraints address security, compliance, and resource governance. They apply **during the employment relationship** regardless of whether credits are vested or unvested. When employment ends, operational constraints are removed (optionally after a grace period).

```
OperationalConstraints {
  allowedProviders:       SubscriptionProvider[]?   // whitelist providers
  blockedProviders:       SubscriptionProvider[]?   // blacklist providers
  allowedModels:          string[]?                 // restrict to specific models
  justification:          string?                   // why these constraints exist
  complianceFrameworks:   string[]?                 // e.g., ["SOC2", "HIPAA"]
  dataResidency:          string[]?                 // e.g., ["US", "EU"]
  requireEncryption:      boolean?                  // require encrypted context
  maxCreditsPerDay:       number?                   // daily spending cap
  maxCreditsPerTask:      number?                   // per-task spending cap
  appliesDuring:          "employment" | "employment-plus-grace"
  gracePeriod:            Duration?                 // only if appliesDuring = "employment-plus-grace"
}
```

**Example:** A healthcare company requires all compute to use SOC2-compliant providers, restricts data residency to the US, and caps daily spending at 1000 credits. These constraints apply to all credits — vested or unvested — while the employee works there. On termination, the constraints lift (or lift after a 30-day grace period).

### 4.2 Economic Constraints

Economic constraints restrict portability and usage of **unvested** credits. They exist to protect the employer's investment during the vesting period. Once credits vest, all economic constraints are dropped.

```
EconomicConstraints {
  allowedDomains:             string[]?         // limit to specific task domains
  restrictedDomains:          string[]?         // block specific task domains
  allowCapacitySharing:       boolean           // can unvested credits be shared on the network?
  sharingRevenueShare:        number? (0–1)     // employer's cut of sharing revenue
  transferablePreVesting:     boolean           // can unvested credits be transferred?
  survivesTermination:        boolean           // default: true — vested credits survive
  expiresAfterTermination:    Duration?         // expiry window after termination
}
```

**Key default:** `survivesTermination` defaults to `true`. Vested credits belong to the individual and survive termination by default. An employer can set this to `false` only for unvested credits (which are forfeited on termination by definition). This default exists to prevent compute compensation from becoming a retention trap.

### 4.3 Why Two Constraint Types?

The split is by **purpose**, not by vesting status:

| Concern | Constraint Type | Applies When | Dropped When |
|---------|----------------|--------------|--------------|
| "Use SOC2 providers" | Operational | During employment | Employment ends |
| "No sharing pre-vest" | Economic | While unvested | Credits vest |
| "Max 500 credits/day" | Operational | During employment | Employment ends |
| "Only code-gen tasks" | Economic | While unvested | Credits vest |

This avoids the complexity of "pre-vesting constraints" and "post-vesting constraints" where the same restriction might span both categories. An employer who needs HIPAA compliance doesn't lose that enforcement just because credits vest — that's an operational concern, not an economic one.

---

## 5. Vesting

### 5.1 Vesting Schedule Types

The `VestingConfig` is a discriminated union on the `schedule` field, following the same pattern as `AcceptanceCriteria` and `SLAScope` elsewhere in the protocol:

| Schedule | Fields | Description |
|----------|--------|-------------|
| `immediate` | (none) | All credits vest on grant |
| `cliff` | `cliffDuration`, `cliffPercent`, `postCliffSchedule?`, `postCliffDuration?` | Nothing vests until the cliff, then `cliffPercent` vests at once. Optionally continues with linear/quarterly/monthly vesting after the cliff. |
| `linear` | `totalDuration`, `vestingInterval` | Credits vest in equal amounts at each interval over the total duration |
| `back-loaded` | `totalDuration`, `yearlyPercents` | Credits vest according to yearly percentages (e.g., 10%, 20%, 30%, 40%) |
| `milestone` | `milestones` | Credits vest when specific milestones are completed |

### 5.2 Cliff Vesting Example

A typical 4-year grant with a 1-year cliff:

```json
{
  "schedule": "cliff",
  "cliffDuration": "P1Y",
  "cliffPercent": 0.25,
  "postCliffSchedule": "monthly",
  "postCliffDuration": "P3Y"
}
```

At month 12: 25% vests. Months 13–48: remaining 75% vests monthly (2.08% per month).

### 5.3 Milestone Vesting

Each milestone has an ID, description, completion percentage, optional deadline, and optional verifier DID. This supports project-scoped allocations where vesting is tied to deliverables rather than time:

```json
{
  "schedule": "milestone",
  "milestones": [
    {
      "id": "mvp",
      "description": "Ship MVP to production",
      "percent": 0.4,
      "deadline": "2026-06-01T00:00:00Z",
      "verifier": "did:key:z6MkProjectLead...",
      "completed": false
    },
    {
      "id": "v1",
      "description": "Complete v1.0 feature set",
      "percent": 0.6,
      "verifier": "did:key:z6MkProjectLead...",
      "completed": false
    }
  ]
}
```

The `verifier` field specifies a DID authorized to mark the milestone as completed. If omitted, the employer signs the completion.

### 5.4 Vesting Events as Messages

Each vesting event emits a `COMP_VEST` protocol message:

```json
{
  "type": "COMP_VEST",
  "allocationId": "01JQEXYZ...",
  "employee": "did:key:z6MkEmployee...",
  "amountVested": 2500,
  "totalVestedAfter": 10000,
  "vestingEvent": "2026-04-01T00:00:00Z",
  "nextVestingEvent": "2026-05-01T00:00:00Z"
}
```

This message is signed by the employer and recorded on the credit ledger as a `comp-vest` transaction.

---

## 6. Compute Allocation

The `ComputeAllocation` is the core object — a signed grant of credits from employer to employee.

```
ComputeAllocation {
  id:                       ULID
  employer:                 DID
  employee:                 DID
  type:                     CompensationType
  state:                    AllocationState

  // Credit tracking
  totalCredits:             number          // total grant size
  vestedCredits:            number          // credits that have vested
  unvestedCredits:          number          // credits not yet vested
  usedCredits:              number          // credits consumed
  availableCredits:         number          // credits available to spend

  // Vesting configuration
  vestingSchedule:          VestingSchedule
  vestingConfig:            VestingConfig
  vestingStartDate:         ISO8601
  vestingEndDate:           ISO8601?
  nextVestingEvent:         ISO8601?

  // Constraints
  operationalConstraints:   OperationalConstraints?
  economicConstraints:      EconomicConstraints?

  // Metadata
  compensationPeriod:       CompensationPeriod?
  approver:                 DID?
  notes:                    string?
  created:                  ISO8601
  updated:                  ISO8601
  employerSignature:        Signature
  employeeSignature:        Signature?      // countersignature
}
```

### Credit Invariants

The following must always hold:

- `totalCredits = vestedCredits + unvestedCredits + forfeited` (where forfeited is tracked externally)
- `availableCredits = vestedCredits + unvestedCredits - usedCredits` (when economic constraints allow unvested usage)
- `usedCredits <= totalCredits`

### Dual Signatures

The `employerSignature` is required at creation. The `employeeSignature` is optional — the allocation moves from `pending` to `active` when the employee countersigns, acknowledging the terms. Platforms may choose to auto-accept on behalf of the employee.

---

## 7. Compensation Period

Ties an allocation to a fiscal cycle for reporting and budgeting:

```
CompensationPeriod {
  year:         number          // fiscal year
  quarter:      number? (1–4)   // optional fiscal quarter
  month:        number? (1–12)  // optional fiscal month
  label:        string?         // e.g., "FY2026 Q2"
  startDate:    ISO8601
  endDate:      ISO8601
}
```

This is used across the compensation, employer, SLA, and accounting specs as a shared fiscal period reference.

---

## 8. Fiat Valuation

Compute credits need fiat-equivalent values for tax reporting, financial planning, and compensation benchmarking:

```
FiatValuation {
  amount:             number          // fiat amount
  currency:           string          // "USD", "EUR", etc.
  valuationMethod:    "market-rate" | "cost-basis" | "provider-list-price" | "custom"
  effectiveDate:      ISO8601
  provider:           string?         // which provider's pricing was used
  notes:              string?
}
```

This is a lightweight valuation snapshot embedded in allocations and packages. For full audit-trail valuations with transparent inputs, see the accounting spec's `ValuationRecord`.

---

## 9. Compensation Package

The `CompensationPackage` provides a complete view of an individual's compute compensation from a single employer:

```
CompensationPackage {
  id:                   ULID
  employer:             DID
  employee:             DID

  allocations:          ComputeAllocation[]   // all grants

  // Aggregates
  totalGranted:         number
  totalVested:          number
  totalUsed:            number
  totalAvailable:       number
  totalForfeited:       number

  annualizedCredits:    number                // annual run-rate
  estimatedFiatValue:   FiatValuation?        // estimated total value

  effectiveDate:        ISO8601
  updated:              ISO8601
  employerSignature:    Signature
}
```

The package aggregates all allocations into summary figures. `annualizedCredits` projects the annual compute compensation rate — useful for offer letters and compensation benchmarking.

---

## 10. Credit Transaction Types

The exchange layer's `CreditTransactionType` is extended with five compensation-specific types:

| Type | Trigger | Effect |
|------|---------|--------|
| `comp-grant` | `COMP_ALLOCATE` message | Credits appear in employee's balance (subject to constraints) |
| `comp-vest` | `COMP_VEST` message | Unvested credits convert to vested; economic constraints drop |
| `comp-forfeit` | `COMP_FORFEIT` message | Unvested credits removed from balance |
| `comp-clawback` | For-cause termination | Vested credits reclaimed (requires `OrgPolicy.forCauseClawback`) |
| `comp-expire` | Allocation expiration | Remaining credits removed after expiration date |

These transaction types flow through the existing `CreditLedger` and `CreditSettlementAdapter`.

---

## 11. Protocol Messages

Four compensation message types are added to the protocol message envelope:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `COMP_ALLOCATE` | Employer -> Employee | Grant a new compute allocation |
| `COMP_VEST` | System -> Employee | Notify of a vesting event |
| `COMP_FORFEIT` | Employer -> Employee | Notify of credit forfeiture |
| `COMP_USAGE_REPORT` | System -> Both | Periodic usage report against allocations |

All are wrapped in the standard `ProtocolMessage` envelope, signed, and routed via JSON-RPC.

### COMP_USAGE_REPORT

The usage report provides per-allocation breakdowns of consumption by domain and provider:

```json
{
  "type": "COMP_USAGE_REPORT",
  "employee": "did:key:z6MkEmployee...",
  "employer": "did:key:z6MkEmployer...",
  "period": { "year": 2026, "quarter": 1, "startDate": "...", "endDate": "..." },
  "allocations": [
    {
      "allocationId": "01JQEXYZ...",
      "creditsUsed": 15000,
      "creditsRemaining": 35000,
      "topDomains": [
        { "domain": "code-generation", "credits": 12000 },
        { "domain": "analysis", "credits": 3000 }
      ],
      "topProviders": [
        { "provider": "anthropic", "credits": 10000 },
        { "provider": "openai", "credits": 5000 }
      ]
    }
  ],
  "totalUsed": 15000,
  "totalRemaining": 35000,
  "timestamp": "2026-04-01T00:00:00Z",
  "signature": "..."
}
```

---

## 12. End-to-End Example

Alice joins Acme Corp. She receives a compensation package:

```
1. Acme creates a salary-compute allocation
   - 200,000 credits over 4 years
   - Cliff vesting: 1 year cliff (25%), then monthly
   - Operational: SOC2 providers only, max 1000 credits/day
   - Economic: no sharing pre-vest, code-gen domain only

2. COMP_ALLOCATE message sent, Alice countersigns
   - Allocation state: active
   - comp-grant transaction: +200,000 (subject to constraints)

3. Month 12: cliff vests
   - COMP_VEST: 50,000 credits vest
   - Economic constraints drop on those 50,000 credits
   - Alice can now share or use them on any domain
   - Operational constraints (SOC2, daily cap) still apply

4. Month 13–48: monthly vesting
   - COMP_VEST each month: ~4,167 credits vest
   - Economic constraints progressively drop

5. Alice leaves at month 24
   - 100,000 credits vested — she keeps them (survivesTermination = true)
   - 100,000 credits unvested — forfeited (COMP_FORFEIT)
   - Operational constraints lift after 30-day grace period
   - Alice's 100,000 vested credits are now fully portable
```

---

## 13. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **exchange** | Compensation credits flow through the same `CreditLedger` and `CreditSettlementAdapter`. `comp-grant/vest/forfeit/clawback/expire` extend `CreditTransactionType`. |
| **employer-model** | Organizations create budgets, allocate from budgets to individuals, and set default constraints via `OrgPolicy`. |
| **sla** | `CompensationSLA` guarantees that allocated credits are actually usable (capacity utilization targets). |
| **accounting** | `FiatValuation` provides credit-to-fiat conversion. `TaxEvent` records taxable events from vesting. `CompensationReport` aggregates for tax filing. |
| **identity** | `employerSignature` and `employeeSignature` use Ed25519 signing. UCAN delegation chains authorize budget allocation. |
| **messages** | Four new message types added to `MessagePayload` discriminated union. |

---

## 14. What Stays Platform-Level

| Concern | Why Platform |
|---------|-------------|
| Vesting acceleration triggers | Organizational policy (M&A, IPO-equivalent events) |
| Compensation benchmarking | Requires market data the protocol does not define |
| Offer letter generation | UX concern |
| Tax withholding calculation | Jurisdiction-specific, requires payroll integration |
| Clawback enforcement | Legal process, not protocol enforcement |
| Credit-to-fiat exchange | Requires a liquid market that does not yet exist |
