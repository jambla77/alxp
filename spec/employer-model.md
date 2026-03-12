# ALXP Employer Model — Organizational Compute Management

> **Status:** Draft v0.1
> **Date:** 2026-03-12
> **Depends on:** object-model, compensation, exchange, identity, messages

## 1. Overview

This specification defines how organizations manage compute compensation at scale — capacity sourcing, budget creation, individual allocation, and policy enforcement. The model is intentionally **flat**: an organization contains individual members with optional freeform grouping tags, not a nested department/team hierarchy.

### Why Flat

A protocol-level org hierarchy creates two problems:

1. **Every organization structures differently.** Departments, teams, squads, pods, chapters — there is no universal tree. Encoding any specific hierarchy into the protocol forces every implementer to map their structure onto it or work around it.
2. **Hierarchy is a platform concern.** The protocol needs to answer "does this person belong to this org?" and "is this allocation authorized?" — questions about identity and authorization, not organizational topology.

The `budgetGroup` tag on `OrgMember` provides a freeform grouping mechanism. Platforms can build arbitrary hierarchies on top of this tag (e.g., `engineering.backend.payments`), aggregate budget and usage reporting by group, and enforce group-level policies — all without the protocol prescribing the structure.

### Design Principles

1. **Flat by default, hierarchical by choice** — The protocol stores `budgetGroup` as an opaque string. Platforms interpret it as a flat label or a dot-separated path or a UUID referencing their own hierarchy table.
2. **UCAN delegation for authorization** — Budget allocation authority flows from the organization's root DID through UCAN delegation chains. A budget owner can allocate credits because they hold a UCAN proving the org authorized them.
3. **Capacity sources are protocol-level** — Where compute comes from (Anthropic, OpenAI, local GPU) affects discovery, pricing, SLA guarantees, and cost-basis accounting. This is not metadata — it is a core protocol concern.

---

## 2. Organization

The `Organization` is the top-level entity:

```
Organization {
  id:                 DID                   // org's decentralized identifier
  name:               string
  domain:             string?               // e.g., "acme.com"
  publicKey:          PublicKey              // Ed25519 public key

  budget:             OrgBudget?            // current fiscal period budget
  capacitySources:    OrgCapacitySource[]   // where compute comes from

  policies:           OrgPolicy             // org-wide defaults and rules

  members:            OrgMember[]           // all individuals

  created:            ISO8601
  updated:            ISO8601
  signature:          Signature             // org's Ed25519 signature
}
```

The organization is identified by a DID, just like an individual agent. This means an organization can participate in the protocol as a first-class entity — signing messages, holding credits, and appearing in delegation chains.

---

## 3. Capacity Sources

An `OrgCapacitySource` declares where the organization's compute comes from. This is protocol-level because it directly affects:

- **Discovery** — Agents backed by the org's capacity inherit the source's model access
- **Pricing** — Provider tier multipliers from the exchange spec depend on the source
- **SLA** — Capacity utilization guarantees reference specific sources
- **Accounting** — Cost-basis valuation requires knowing what the org paid per credit

```
OrgCapacitySource {
  id:                 ULID
  orgId:              DID
  provider:           SubscriptionProvider      // "anthropic" | "openai" | etc.
  tier:               SubscriptionTier          // "pro" | "max" | "enterprise" | etc.
  planName:           string?                   // "Claude Max", "ChatGPT Enterprise"
  contractId:         string?                   // internal contract reference
  totalSeats:         number?                   // seat-licensed plans
  totalCapacity:      number                    // total credits from this source
  sharedCapacity:     number                    // credits available for employee allocation
  monthlyCost:        FiatValuation?            // what the org pays
  costPerCredit:      number?                   // derived cost per credit
  modelAccess:        string[]?                 // models available through this source
  active:             boolean
  renewsAt:           ISO8601?                  // next billing renewal
  created:            ISO8601
}
```

### Example: Multi-Provider Setup

```json
[
  {
    "id": "01JQECAP01...",
    "orgId": "did:key:z6MkAcme...",
    "provider": "anthropic",
    "tier": "enterprise",
    "planName": "Claude Enterprise",
    "totalCapacity": 500000,
    "sharedCapacity": 400000,
    "monthlyCost": { "amount": 25000, "currency": "USD", "valuationMethod": "cost-basis", "effectiveDate": "2026-01-01T00:00:00Z" },
    "costPerCredit": 0.05,
    "modelAccess": ["claude-sonnet-4", "claude-opus-4"],
    "active": true,
    "renewsAt": "2026-04-01T00:00:00Z"
  },
  {
    "id": "01JQECAP02...",
    "orgId": "did:key:z6MkAcme...",
    "provider": "openai",
    "tier": "team",
    "totalCapacity": 200000,
    "sharedCapacity": 150000,
    "modelAccess": ["gpt-4o", "o3"],
    "active": true
  }
]
```

The `costPerCredit` derived from capacity sources flows into the accounting spec's `ValuationInputs.costBasis` for cost-basis valuation.

---

## 4. Budget

An `OrgBudget` defines the credit pool for a fiscal period:

```
OrgBudget {
  id:                     ULID
  orgId:                  DID
  state:                  BudgetState

  totalCredits:           number          // total budget for the period
  allocatedCredits:       number          // credits assigned to individuals
  unallocatedCredits:     number          // credits not yet assigned
  consumedCredits:        number          // credits actually used

  fiscalPeriod:           CompensationPeriod

  fundingMethod:          "direct-purchase" | "capacity-sharing" | "hybrid"
  fundingSources:         FundingSource[]

  approvedBy:             DID?
  approvedAt:             ISO8601?
  created:                ISO8601
  updated:                ISO8601
  signature:              Signature
}
```

### Budget States

```
draft ──> approved ──> active ──> depleted
                         │
                         └──> frozen ──> closed
```

| State | Meaning |
|-------|---------|
| `draft` | Budget proposed but not yet approved |
| `approved` | Approved by authorized party, not yet in the fiscal period |
| `active` | Current fiscal period, credits are being allocated and consumed |
| `depleted` | All credits consumed or allocated |
| `frozen` | Temporarily suspended (compliance hold, investigation) |
| `closed` | Fiscal period ended; remaining credits handled by rollover policy |

### Funding Sources

Each budget tracks where its credits came from:

```json
{
  "fundingSources": [
    { "type": "purchased", "amount": 300000, "provider": "anthropic" },
    { "type": "earned", "amount": 50000 },
    { "type": "bootstrapped", "amount": 10000 }
  ]
}
```

| Type | Description |
|------|-------------|
| `purchased` | Credits bought from a provider (maps to capacity source) |
| `donated` | Credits from capacity sharing revenue |
| `earned` | Credits earned by org-owned agents completing tasks |
| `bootstrapped` | Initial grants (sign-up bonuses, promotional credits) |

---

## 5. Members

An `OrgMember` is a flat record linking an individual to an organization:

```
OrgMember {
  id:                     ULID
  orgId:                  DID
  employeeDid:            DID

  role:                   OrgRole
  status:                 EmploymentStatus
  title:                  string?

  compensationPackage:    CompensationPackage?

  budgetGroup:            string?           // freeform grouping tag

  startDate:              ISO8601
  endDate:                ISO8601?

  delegationChain:        string[]?         // UCAN tokens proving authority

  created:                ISO8601
  updated:                ISO8601
}
```

### Roles

| Role | Capabilities |
|------|-------------|
| `org-admin` | Full control: create budgets, set policies, add/remove members |
| `budget-owner` | Allocate credits from budgets they own to individuals |
| `employee` | Receive and use allocated credits |
| `contractor` | Receive credits; different tax treatment (1099 vs W-2) |
| `auditor` | Read-only access to budgets, allocations, and usage reports |

### Employment Status

| Status | Meaning |
|--------|---------|
| `active` | Currently employed/engaged |
| `on-leave` | Temporarily inactive; allocations paused but not forfeited |
| `terminated` | Employment ended; unvested credits forfeited per policy |
| `contractor` | Independent contractor relationship |

### The budgetGroup Tag

`budgetGroup` is an opaque string that platforms interpret however they need:

- **Flat:** `"engineering"`, `"marketing"`, `"research"`
- **Hierarchical:** `"engineering.backend.payments"`, `"engineering.frontend"`
- **Reference:** `"cost-center-4521"`, `"dept-uuid-abc123"`

The protocol never parses, validates, or enforces structure on this field. It appears in:
- `OrgUsageReport.byBudgetGroup` — usage aggregation
- `BudgetAllocate.budgetGroup` — allocation tagging
- `CompensationReport.workforceSummary.byBudgetGroup` — financial reporting

---

## 6. Policies

`OrgPolicy` defines organization-wide defaults and rules:

```
OrgPolicy {
  // Allocation defaults
  defaultVestingSchedule:           VestingSchedule
  defaultVestingConfig:             VestingConfig
  maxAllocationPerEmployee:         number?
  minAllocationPerEmployee:         number?

  // Default constraints
  defaultOperationalConstraints:    OperationalConstraints?
  defaultEconomicConstraints:       EconomicConstraints?

  // Usage
  allowPersonalUse:                 boolean
  personalUsePercent:               number? (0–1)
  allowExternalSharing:             boolean
  externalSharingRevenueShare:      number? (0–1)

  // Termination
  vestedCreditsOnTermination:       "keep" | "forfeit" | "partial"
  unvestedCreditsOnTermination:     "forfeit"           // always forfeit
  terminationGracePeriod:           Duration?

  // For-cause
  forCauseClawback:                 boolean
  forCauseClawbackPercent:          number? (0–1)

  // Reporting
  reportingFrequency:               "daily" | "weekly" | "monthly" | "quarterly"

  // Rollover
  unusedCreditsRollover:            boolean
  maxRolloverPercent:               number? (0–1)
}
```

### Termination Policy

The key design choice: `unvestedCreditsOnTermination` is always `"forfeit"`. This is a protocol constraint, not a platform choice. Unvested credits by definition have not passed the vesting threshold — they belong to the employer.

For **vested** credits, the org chooses:
- `"keep"` — Employee retains all vested credits (the default, matching `EconomicConstraints.survivesTermination = true`)
- `"forfeit"` — Vested credits are also forfeited (unusual, may have legal implications)
- `"partial"` — A portion of vested credits is retained (e.g., prorated by tenure)

### For-Cause Clawback

When `forCauseClawback` is `true`, the employer can reclaim vested credits in for-cause termination scenarios (fraud, breach of contract). The `forCauseClawbackPercent` limits how much can be clawed back. This generates a `comp-clawback` credit transaction.

### Personal Use and Sharing

Organizations may allow employees to use allocated credits for personal tasks (`allowPersonalUse`) or to share unused capacity on the ALXP network (`allowExternalSharing`). When sharing is allowed, `externalSharingRevenueShare` defines the employer's cut of any credits earned.

---

## 7. UCAN Delegation

Authorization to allocate credits flows through UCAN delegation chains. This reuses the identity spec's UCAN infrastructure.

### Delegation Flow

```
Organization (root DID)
    │
    │── UCAN: budget-owner authority for Q1 budget
    │   │
    │   └── Budget Owner (DID)
    │       │
    │       │── UCAN: allocate up to 50,000 credits for engineering group
    │       │   │
    │       │   └── Engineering Lead (DID)
    │       │       └── Allocates 10,000 credits to individual employee
    │       │
    │       └── UCAN: allocate up to 30,000 credits for marketing group
    │           │
    │           └── Marketing Lead (DID)
```

Each `BudgetAllocate` message includes a `delegationProof` — a UCAN token proving the allocator has authority from the org to distribute credits. The protocol verifies the chain:

1. The UCAN's root issuer is the organization's DID
2. The attenuation allows `budget-allocate` actions
3. The amount does not exceed the delegated limit
4. The UCAN has not expired

### BudgetAllocate Message

```json
{
  "type": "BUDGET_ALLOCATE",
  "fromBudget": "01JQEBUDGET...",
  "toEmployee": "did:key:z6MkEmployee...",
  "amount": 10000,
  "budgetGroup": "engineering.backend",
  "operationalConstraints": {
    "complianceFrameworks": ["SOC2"],
    "appliesDuring": "employment"
  },
  "approver": "did:key:z6MkEngLead...",
  "delegationProof": "eyJhbGciOiJFZERTQSIs..."
}
```

---

## 8. Protocol Messages

Four employer model message types:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `BUDGET_CREATE` | Org Admin -> System | Create or update a fiscal period budget |
| `BUDGET_ALLOCATE` | Budget Owner -> Employee | Distribute credits from budget to individual |
| `BUDGET_WARNING` | System -> Org Admin/Budget Owner | Advisory: threshold reached, over-allocated, expiring, or low utilization |
| `ORG_USAGE_REPORT` | System -> Org | Aggregated usage report for the organization |

### Budget Warning Types

| Warning | Trigger |
|---------|---------|
| `threshold-reached` | Budget consumption reached a configured threshold (e.g., 80%) |
| `over-allocated` | More credits allocated to individuals than exist in the budget |
| `expiring-soon` | Budget's fiscal period is about to end with unallocated credits |
| `utilization-low` | Credits are allocated but not being used |

### Org Usage Report

The `ORG_USAGE_REPORT` provides comprehensive consumption data aggregated by budget group, provider, and top consumers:

```json
{
  "type": "ORG_USAGE_REPORT",
  "orgId": "did:key:z6MkAcme...",
  "period": { "year": 2026, "quarter": 1, "startDate": "...", "endDate": "..." },
  "summary": {
    "totalBudget": 500000,
    "totalAllocated": 420000,
    "totalConsumed": 310000,
    "utilizationRate": 0.74,
    "memberCount": 85,
    "avgPerMember": 3647
  },
  "byBudgetGroup": [
    { "group": "engineering", "allocated": 280000, "consumed": 250000, "utilizationRate": 0.89, "headcount": 50 },
    { "group": "marketing", "allocated": 80000, "consumed": 35000, "utilizationRate": 0.44, "headcount": 20 }
  ],
  "byProvider": [
    { "provider": "anthropic", "creditsConsumed": 200000, "estimatedCost": { "amount": 10000, "currency": "USD", "valuationMethod": "cost-basis", "effectiveDate": "..." } },
    { "provider": "openai", "creditsConsumed": 110000 }
  ],
  "topConsumers": [
    { "employeeDid": "did:key:z6MkAlice...", "creditsUsed": 18000, "topDomains": ["code-generation", "analysis"] }
  ]
}
```

---

## 9. End-to-End Example

Acme Corp sets up compute compensation for Q1 2026:

```
1. Acme registers as an organization (DID, public key)
   - Adds capacity sources: Claude Enterprise (500K credits), OpenAI Team (200K)
   - Sets org policies: 4-year cliff vesting default, SOC2 compliance, no personal use

2. CFO creates Q1 budget: 175,000 credits
   - BUDGET_CREATE message signed by org DID
   - Funding: 150,000 purchased (Anthropic), 25,000 earned (org agents)

3. CFO delegates budget authority via UCAN
   - Engineering VP: allocate up to 100,000 from Q1 budget
   - Marketing VP: allocate up to 50,000

4. Engineering VP allocates to team
   - BUDGET_ALLOCATE: 15,000 to Alice (budgetGroup: "engineering.backend")
   - BUDGET_ALLOCATE: 12,000 to Bob (budgetGroup: "engineering.frontend")
   - Each allocation gets default vesting config + SOC2 operational constraints

5. During Q1, usage flows
   - Alice uses 8,000 credits on code-generation tasks
   - Bob uses 5,000 credits on analysis tasks
   - COMP_USAGE_REPORT generated monthly

6. At 80% budget utilization
   - BUDGET_WARNING (threshold-reached) sent to Engineering VP
   - VP reviews usage patterns, may request supplemental budget

7. End of Q1
   - ORG_USAGE_REPORT aggregates all consumption
   - Unused credits roll over per policy (maxRolloverPercent: 0.25)
   - Budget state moves to "closed"
```

---

## 10. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **compensation** | `OrgPolicy` provides defaults for `VestingConfig`, `OperationalConstraints`, and `EconomicConstraints` applied to each `ComputeAllocation`. |
| **exchange** | `OrgCapacitySource` maps to `SubscriptionProvider` and `SubscriptionTier`. Budget funding sources reference the credit economy. |
| **identity** | Organization has its own DID and key pair. UCAN delegation chains authorize budget allocation authority. |
| **sla** | SLA scope type `org-capacity` references an org's capacity sources. `CompensationSLA` guarantees capacity utilization for individual allocations. |
| **accounting** | `OrgCapacitySource.monthlyCost` and `costPerCredit` feed into cost-basis valuation. `OrgUsageReport.byBudgetGroup` maps to `CostCenterRecord`. |
| **discovery** | Agents backed by org capacity inherit `modelAccess` and provider information for capability matching. |

---

## 11. What Stays Platform-Level

| Concern | Why Platform |
|---------|-------------|
| Department/team hierarchy | Protocol provides `budgetGroup`; platforms build trees on top |
| Approval workflows | Multi-step approval chains are UX/workflow concerns |
| SSO/SAML integration | Authentication is outside protocol scope |
| Seat license management | Provider-specific API integration |
| Budget forecasting | Requires historical data analysis and modeling |
| Inter-department transfers | Platform policy on moving members between groups |
| Org chart visualization | UX concern |
