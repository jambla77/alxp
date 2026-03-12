# ALXP Service Level Agreements — Capacity Utilization Guarantees

> **Status:** Draft v0.1
> **Date:** 2026-03-12
> **Depends on:** object-model, compensation, employer-model, exchange, messages

## 1. Overview

This specification defines service level agreements (SLAs) for the ALXP compensation layer. An SLA is a guarantee that allocated compute credits are actually usable — that the capacity behind them is available when the employee needs it.

The primary SLA metric is **capacity utilization**: "95% of your allocated credits were usable during Q1." This is measured periodically at reporting boundaries, not in real-time. SLAs in ALXP are compliance instruments, not monitoring dashboards.

### Why Periodic, Not Real-Time

Traditional SLAs (cloud infrastructure, APIs) guarantee uptime — "99.9% available in any rolling 30-minute window." That model does not fit compute compensation for three reasons:

1. **Compute capacity is inherently bursty.** An employee might use zero credits on Monday and 5,000 on Tuesday. A real-time availability metric would fluctuate wildly and produce meaningless alerts.
2. **The question is different.** The employer is not asking "was the API up?" — they are asking "could Alice use her credits when she tried to?" This is answered by looking at a period's total usable capacity vs. allocated capacity.
3. **Remediation is periodic.** If credits were not usable in Q1, the remediation is an extension of credits — not a real-time failover. The reporting cycle matches the remediation cycle.

### Design Principles

1. **Capacity utilization is the primary metric** — Other metrics (latency, error rate, throughput) are available but secondary. The core SLA question is: "Were the credits usable?"
2. **Evaluated at boundaries** — SLA compliance is assessed at the end of each reporting window (monthly, quarterly), not continuously.
3. **Remediation, not penalties** — On breach, the protocol defines credit extensions and provider failover, not financial penalties. Penalties are a platform/contract concern.
4. **Scoped flexibly** — SLAs can target an individual agent, an organization's capacity source, or a specific compensation allocation.

---

## 2. SLA Metrics

### 2.1 Metric Types

| Metric | Description | Primary? |
|--------|-------------|----------|
| `capacity-utilization` | Fraction of allocated credits that were usable during the period | **Yes** |
| `availability` | Fraction of time the capacity source was accessible | Secondary |
| `latency-p95` | 95th-percentile response latency for tasks | Secondary |
| `error-rate` | Fraction of tasks that failed due to infrastructure (not quality) | Secondary |
| `throughput` | Sustained task completion rate | Secondary |

`capacity-utilization` is the metric that matters for compute compensation. If an employer allocates 50,000 credits for Q1 and only 45,000 were actually usable (because a provider had outages, rate limits hit, or models were unavailable), the utilization rate is 0.90.

### 2.2 SLA Target

Each target defines a specific measurable commitment:

```
SLATarget {
  metric:             SLAMetricType
  target:             number              // target value (e.g., 0.95 for 95%)
  unit:               string              // "ratio", "ms", "tasks/hour"
  window:             Duration            // measurement window (e.g., "P3M" for quarterly)
  windowType:         "rolling" | "calendar"
  warningThreshold:   number?             // alert before breach (e.g., 0.92)
  breachThreshold:    number              // breach level (e.g., 0.90)
}
```

**Example:** "95% capacity utilization per calendar quarter, warn at 92%, breach at 90%."

```json
{
  "metric": "capacity-utilization",
  "target": 0.95,
  "unit": "ratio",
  "window": "P3M",
  "windowType": "calendar",
  "warningThreshold": 0.92,
  "breachThreshold": 0.90
}
```

---

## 3. SLA Scope

An SLA applies to a specific entity, defined by a discriminated union:

```
SLAScope =
  | { type: "agent",          agentId: DID }
  | { type: "org-capacity",   orgId: DID, capacitySourceId?: ULID }
  | { type: "allocation",     allocationId: ULID, employeeDid: DID }
```

| Scope | Use Case |
|-------|----------|
| `agent` | SLA on a specific agent's capacity (e.g., a shared agent pool member) |
| `org-capacity` | SLA on an organization's capacity source (e.g., "our Anthropic Enterprise plan will be 99% available"). Optionally scoped to a specific `OrgCapacitySource`. |
| `allocation` | SLA on an individual's compensation allocation (e.g., "Alice's 50,000 Q1 credits will be 95% usable") |

The `allocation` scope is the most common for compute compensation. It ties an SLA directly to a `ComputeAllocation`, guaranteeing that the credits granted are actually usable.

---

## 4. SLA States

```
active ──> warning ──> breached
  │                       │
  └──> expired            └──> expired
```

| State | Meaning |
|-------|---------|
| `active` | SLA is in effect, all targets are being met |
| `warning` | At least one target has crossed its warning threshold |
| `breached` | At least one target has crossed its breach threshold |
| `expired` | SLA's effective period has ended |

State transitions are evaluated at each reporting interval, not in real-time.

---

## 5. SLA Definition

The complete SLA object:

```
SLADefinition {
  id:                   ULID
  name:                 string

  scope:                SLAScope
  effortTier:           EffortTier?         // SLA may apply only to specific effort levels

  targets:              SLATarget[]
  monitoringConfig:     MonitoringConfig
  remediationPolicy:    RemediationPolicy

  effectiveDate:        ISO8601
  expiresAt:            ISO8601?
  state:                SLAState

  owner:                DID                 // who is responsible for meeting the SLA
  created:              ISO8601
  updated:              ISO8601
  signature:            Signature
}
```

The `effortTier` field allows scoping an SLA to specific task complexity levels. For example, an employer might guarantee 99% capacity utilization for `critical` tasks but only 90% for `trivial` tasks.

---

## 6. Monitoring

### 6.1 Monitoring Configuration

```
MonitoringConfig {
  reportingInterval:    Duration            // how often to generate SLA reports
  dataSource:           "metering-reports" | "credit-transactions" | "both"
  heartbeatRequired:    boolean?            // require agent heartbeats for liveness
  heartbeatInterval:    Duration?           // expected heartbeat frequency
  alertOnWarning:       boolean
  alertOnBreach:        boolean
  alertRecipients:      DID[]               // who receives alerts
}
```

### 6.2 Data Sources

SLA compliance is computed from existing protocol data:

| Source | What It Provides |
|--------|-----------------|
| **Metering reports** | Actual resource consumption per task — tokens used, wall-clock time, provider breakdown |
| **Credit transactions** | Credit movements — grants, vesting, spending, failures. A failed transaction (insufficient capacity) counts against utilization. |
| **Both** | Cross-referenced for accuracy. Metering shows what was consumed; transactions show what was attempted. |

The monitoring system does not require new data collection. It aggregates data that already flows through the protocol's metering and credit systems.

### 6.3 Compliance Evaluation

At each reporting interval:

1. Collect all metering reports and credit transactions for the period
2. For each SLA target, compute the actual metric value
3. Compare actual against warning and breach thresholds
4. Update SLA state
5. Generate an `SLAReport`
6. If warning or breach: execute remediation policy and notify recipients

---

## 7. SLA Reports

An `SLAReport` is generated at the end of each reporting window:

```
SLAReport {
  id:                   ULID
  slaId:                ULID

  period: {
    start:              ISO8601
    end:                ISO8601
    label:              string            // e.g., "Q1 2026"
  }

  compliant:            boolean           // overall compliance
  state:                SLAState          // state at end of period

  metrics: [{
    metric:             SLAMetricType
    target:             number            // what was promised
    actual:             number            // what was delivered
    compliant:          boolean           // did this metric pass?
    dataPoints:         number            // how many observations
  }]

  capacityDetail: {                       // present for capacity-utilization SLAs
    allocatedCredits:   number
    usableCredits:      number            // credits that were actually usable
    utilizationRate:    number (0–1)
    consumedCredits:    number            // credits actually consumed
    shortfallCredits:   number?           // credits that should have been usable but weren't
  }?

  remediations: [{                        // actions taken
    type:               RemediationType
    creditsExtended:    number?
    notes:              string?
  }]?

  generated:            ISO8601
  signature:            Signature
}
```

### Example Report

```json
{
  "id": "01JQESLA01...",
  "slaId": "01JQESLADEF...",
  "period": { "start": "2026-01-01T00:00:00Z", "end": "2026-04-01T00:00:00Z", "label": "Q1 2026" },
  "compliant": false,
  "state": "breached",
  "metrics": [
    {
      "metric": "capacity-utilization",
      "target": 0.95,
      "actual": 0.88,
      "compliant": false,
      "dataPoints": 2340
    }
  ],
  "capacityDetail": {
    "allocatedCredits": 50000,
    "usableCredits": 44000,
    "utilizationRate": 0.88,
    "consumedCredits": 38000,
    "shortfallCredits": 6000
  },
  "remediations": [
    {
      "type": "credit-extension",
      "creditsExtended": 6000,
      "notes": "Anthropic rate limiting during week 8-9 caused capacity shortfall"
    }
  ]
}
```

In this example, the employer promised 95% of Alice's 50,000 credits would be usable in Q1. Only 88% (44,000) were usable due to provider rate limiting. The SLA is breached, and 6,000 credits are extended as remediation.

---

## 8. Remediation

### 8.1 Remediation Types

| Type | Description |
|------|-------------|
| `credit-extension` | Grant additional credits to compensate for the shortfall |
| `provider-failover` | Route future tasks to an alternative capacity source |
| `notification-only` | Alert stakeholders without automatic action |

### 8.2 Remediation Policy

```
RemediationPolicy {
  actions:                  RemediationAction[]
  maxRemediationCredits:    number?           // cap on credits extended per period
}
```

Each action specifies when it triggers:

```
RemediationAction {
  trigger:                  "warning" | "breach"
  action:                   RemediationType
  creditExtensionPercent:   number? (0–1)     // percent of shortfall to extend
  notifyDids:               DID[]?            // additional notification recipients
}
```

### 8.3 Example Remediation Policy

```json
{
  "actions": [
    {
      "trigger": "warning",
      "action": "notification-only",
      "notifyDids": ["did:key:z6MkBudgetOwner..."]
    },
    {
      "trigger": "breach",
      "action": "credit-extension",
      "creditExtensionPercent": 1.0,
      "notifyDids": ["did:key:z6MkBudgetOwner...", "did:key:z6MkEmployee..."]
    },
    {
      "trigger": "breach",
      "action": "provider-failover"
    }
  ],
  "maxRemediationCredits": 10000
}
```

On warning: notify the budget owner. On breach: extend credits for the full shortfall (up to 10,000 cap) and fail over to an alternative provider.

---

## 9. Compensation SLA

The `CompensationSLA` is a simplified SLA shape for embedding directly in compensation allocations:

```
CompensationSLA {
  allocationId:         ULID
  employee:             DID
  employer:             DID

  guarantees: {
    capacityUtilization:  number (0–1)      // e.g., 0.95
    period:               Duration           // e.g., "P3M" (quarterly)
    modelAvailability:    string[]?          // specific models guaranteed available
  }

  remediation: {
    action:               RemediationType
    creditExtensionPercent: number? (0–1)
  }
}
```

This is a convenience type. For complex SLAs with multiple targets and monitoring configurations, use the full `SLADefinition`. `CompensationSLA` covers the common case: "95% of your credits will be usable each quarter, and we'll extend credits if they're not."

---

## 10. Protocol Messages

Two SLA message types:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `SLA_DECLARE` | Owner -> System | Publish an SLA definition |
| `SLA_REPORT` | System -> Stakeholders | Periodic compliance report |

### SLA_DECLARE

```json
{
  "type": "SLA_DECLARE",
  "sla": {
    "id": "01JQESLADEF...",
    "name": "Q1 2026 Engineering Capacity",
    "scope": { "type": "org-capacity", "orgId": "did:key:z6MkAcme..." },
    "targets": [
      { "metric": "capacity-utilization", "target": 0.95, "unit": "ratio", "window": "P3M", "windowType": "calendar", "warningThreshold": 0.92, "breachThreshold": 0.90 }
    ],
    "monitoringConfig": {
      "reportingInterval": "P1M",
      "dataSource": "both",
      "alertOnWarning": true,
      "alertOnBreach": true,
      "alertRecipients": ["did:key:z6MkCFO...", "did:key:z6MkVPEng..."]
    },
    "remediationPolicy": {
      "actions": [
        { "trigger": "breach", "action": "credit-extension", "creditExtensionPercent": 1.0 }
      ]
    },
    "effectiveDate": "2026-01-01T00:00:00Z",
    "expiresAt": "2026-04-01T00:00:00Z",
    "state": "active",
    "owner": "did:key:z6MkAcme..."
  }
}
```

---

## 11. End-to-End Example

Acme Corp guarantees capacity utilization for engineering:

```
1. Acme declares an SLA
   - Scope: org-capacity (Anthropic Enterprise source)
   - Target: 95% capacity utilization per quarter
   - Warning at 92%, breach at 90%
   - Remediation: extend credits on breach, failover to OpenAI
   - Monitoring: monthly reports from metering data

2. January report (Month 1)
   - Utilization: 97% — compliant
   - SLA_REPORT generated, state: active
   - No action needed

3. February report (Month 2)
   - Anthropic had rate limiting issues during week 2
   - Utilization: 91% — warning threshold crossed
   - BUDGET_WARNING sent to VP Engineering
   - SLA state: warning

4. March report (Month 3)
   - Anthropic issues resolved, but cumulative Q1 impact remains
   - Quarterly utilization: 93% — still below 95% target
   - But above 90% breach threshold
   - SLA state remains: warning (not breached)

5. End of Q1 — final SLA_REPORT
   - Overall Q1 utilization: 93%
   - Target: 95%, breach: 90%
   - Result: warning (not breached)
   - No credit extension needed
   - SLA state: active (reset for next period)

6. (Alternative) If Q1 utilization were 88%:
   - Breached: below 90% threshold
   - Credit extension: 6,000 credits (shortfall amount)
   - Provider failover triggered for Q2
   - SLA_REPORT documents the breach and remediation
```

---

## 12. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **compensation** | `CompensationSLA` is embedded in or associated with `ComputeAllocation`. SLA breaches may trigger credit extensions that modify allocation balances. |
| **employer-model** | `OrgCapacitySource` is the backing for org-capacity scoped SLAs. SLA reports feed into `OrgUsageReport`. |
| **exchange** | SLA monitoring consumes `MeteringReport` data and `CreditTransaction` records. Credit extensions are `CreditTransaction` entries. |
| **accounting** | SLA compliance reports inform `CompensationReport` — breaches and remediations are documented for audit. |
| **messages** | `SLA_DECLARE` and `SLA_REPORT` added to `MessagePayload` discriminated union. |

---

## 13. What Stays Platform-Level

| Concern | Why Platform |
|---------|-------------|
| Real-time monitoring dashboards | UX concern; protocol defines periodic reports |
| Custom metric definitions | Protocol covers the common metrics; platforms extend for specialized needs |
| Multi-SLA conflict resolution | When multiple SLAs apply to the same entity, resolution strategy is platform policy |
| Provider-specific health checks | Detecting Anthropic vs. OpenAI outages requires provider API integration |
| SLA pricing / premium tiers | Business model concern |
| Automated capacity scaling | Requires infrastructure integration outside protocol scope |
