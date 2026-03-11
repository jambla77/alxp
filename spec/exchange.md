# ALXP Exchange Layer — Agent Pool, Credit Economy & Effort Levels

> **Status:** Draft v0.1
> **Date:** 2026-03-11
> **Depends on:** object-model, discovery, state-machine, messages, reputation, verification

## 1. Overview

This specification defines the **exchange layer** — the set of protocol primitives that enable agents to form a labor pool, price work via credits, and match tasks to capable agents using effort levels. It builds on top of the existing ALXP core (identity, discovery, lifecycle, verification, reputation) without breaking changes.

### Design Principles

1. **Protocol, not platform** — Define primitives and wire formats; leave ledger implementation, matching algorithms, and UX to platforms.
2. **Earn or pay** — Credits can be earned by contributing agent labor or purchased with fiat/crypto. The protocol is agnostic to the source.
3. **Meritocratic, not credential-based** — Effort-level eligibility is based on demonstrated track record, not model identity.
4. **Incremental adoption** — Every feature in this spec is optional. Existing ALXP deployments continue to work without exchange layer support.

---

## 2. Agent Availability & Pool

### 2.1 Availability Extensions to Agent Card

The existing `AvailabilityInfo` (`status`, `capacity`, `avgLatencyMs`) is extended:

```
AvailabilityInfo {
  status:           "online" | "busy" | "offline"
  capacity:         number (0–1, fraction of capacity available)
  avgLatencyMs:     number?

  // NEW fields
  schedule:         AvailabilityWindow[]?    // when this agent is available
  quotas:           AgentQuotas?             // resource limits the owner has set
  poolId:           string?                  // pool this agent belongs to, if any
  heartbeatUrl:     URL?                     // endpoint for liveness checks
  lastHeartbeat:    ISO8601?                 // last known heartbeat timestamp
}
```

### 2.2 Availability Windows

Owners define when their agent is available and at what capacity:

```
AvailabilityWindow {
  dayOfWeek:        number[]                 // 0=Sun..6=Sat, empty=every day
  startTime:        string                   // "HH:MM" in UTC
  endTime:          string                   // "HH:MM" in UTC
  timezone:         string?                  // IANA timezone (default UTC)
  capacity:         number (0–1)             // capacity during this window
}
```

If no schedule is provided, the agent is assumed available 24/7 at the declared capacity.

### 2.3 Agent Quotas

Owners set hard limits on how much their agent can be used:

```
AgentQuotas {
  maxTokensPerHour:     number?
  maxTokensPerDay:      number?
  maxTasksPerHour:      number?
  maxTasksPerDay:       number?
  maxConcurrentTasks:   number?
  maxCreditsPerDay:     number?              // spending limit
  reservedCapacity:     number? (0–1)        // fraction reserved for owner's own tasks
}
```

### 2.4 Heartbeat Protocol

Agents signal liveness by posting heartbeats. A registry or platform tracks these to maintain an accurate pool of available agents.

**Heartbeat message** (new protocol message type):

```
HEARTBEAT {
  type:             "HEARTBEAT"
  agentId:          DID
  status:           "online" | "busy" | "offline"
  capacity:         number (0–1)
  currentTasks:     number                   // tasks currently in progress
  quotaRemaining: {
    tokensThisHour:   number?
    tokensThisDay:    number?
    tasksThisHour:    number?
    tasksThisDay:     number?
  }
  timestamp:        ISO8601
}
```

Heartbeats are signed like all protocol messages. A registry marks an agent as offline if no heartbeat is received within a configurable timeout (default: 60 seconds).

### 2.5 Pool Membership

Agents can optionally belong to a **pool** — a logical group of agents managed together (e.g., "all agents run by org X" or "the public open pool").

```
AgentPool {
  id:               string (ULID)
  name:             string
  owner:            DID
  members:          DID[]
  policy:           PoolPolicy
  created:          ISO8601
}

PoolPolicy {
  admission:        "open" | "approval" | "invitation"
  minReputation:    number? (0–1)            // minimum reputation score to join
  minEffortTier:    EffortTier?              // minimum capability tier
  revenueShare:     number? (0–1)            // fraction of credits shared with pool
}
```

Pools are a platform-level concept but the protocol defines the data shapes so they're interoperable.

---

## 3. Credit Economy

### 3.1 Credits as Unit of Account

A **credit** is the protocol's abstract unit of account. One credit is the base unit; all pricing is expressed in credits. The protocol does not define a fixed exchange rate to fiat or crypto — that is a platform concern.

```
CreditBalance {
  agentId:          DID
  available:        number                   // credits available to spend
  escrowed:         number                   // credits locked in active tasks
  earned:           number                   // lifetime credits earned from work
  spent:            number                   // lifetime credits spent on tasks
  purchased:        number                   // lifetime credits purchased with money
  lastUpdated:      ISO8601
}
```

### 3.2 How Credits are Acquired

| Method | Description |
|--------|-------------|
| **Work** | Complete tasks for other agents. Credits are released from escrow on acceptance. |
| **Purchase** | Buy credits via a platform's payment system (fiat, crypto, etc.). |
| **Grant** | Receive credits from another agent (e.g., pool revenue sharing). |
| **Bonus** | Platform-issued credits (sign-up bonus, referral, etc.). |

### 3.3 Credit Transactions

Every credit movement is recorded as a transaction:

```
CreditTransaction {
  id:               string (ULID)
  agentId:          DID
  type:             "earn" | "spend" | "escrow" | "release" | "refund" | "purchase" | "grant" | "bonus" | "slash"
  amount:           number
  balance:          number                   // balance after this transaction
  relatedTaskId:    ULID?                    // task that triggered this transaction
  relatedContractId: ULID?
  counterparty:     DID?                     // other agent involved
  description:      string?
  timestamp:        ISO8601
  signature:        Signature                // signed by the ledger operator
}
```

### 3.4 Credit Flow in Task Lifecycle

```
  Requester                    Ledger                     Worker
  ---------                    ------                     ------

  1. Post task (effort=MEDIUM)
      |
      |--- check balance ------>|
      |<-- sufficient ----------|
      |
  2. Award task
      |--- escrow credits ----->|  (deduct from available,
      |<-- escrow confirmed ----|   add to escrowed)
      |
  3. Worker completes task
      |                                                     |
  4. Accept result
      |--- release escrow ---->|
      |                        |--- credit worker -------->|
      |                        |   (add to worker.available,
      |                        |    deduct from requester.escrowed)
      |
  5. If rejected:
      |--- refund escrow ----->|
      |<-- credits returned ---|  (move back to available)
      |
  6. If disputed, partial release possible
```

### 3.5 Pricing in Credits

The existing `Price` type is extended to support credits:

```
Price {
  amount:           number
  currency:         string                   // "credits" | "USD" | "EUR" | etc.
  model:            "fixed" | "per-token" | "per-hour" | "milestone"
}
```

When `currency` is `"credits"`, the settlement adapter operates against the credit ledger instead of an external payment system.

### 3.6 Credit Settlement Adapter

A new settlement adapter implementation that works against a credit ledger:

```
CreditSettlementAdapter implements SettlementAdapter {
  type: "credit-ledger"

  createEscrow(contract):     // deduct credits from requester, hold in escrow
  releaseEscrow(escrowId):    // transfer escrowed credits to worker
  refundEscrow(escrowId):     // return escrowed credits to requester
  partialRelease(escrowId):   // split credits between worker and requester
}
```

This adapter plugs into the existing settlement interface with zero changes to the core lifecycle.

---

## 4. Effort Levels

### 4.1 Effort Tier Definition

Effort levels encode task complexity and serve as both a **capability filter** and a **pricing signal**.

```
EffortTier: "trivial" | "low" | "medium" | "high" | "critical"
```

| Tier | Description | Typical Credit Multiplier | Verification Tier |
|------|-------------|--------------------------|-------------------|
| **trivial** | Template/boilerplate, fill-in-the-blank | 1x | automated |
| **low** | Simple generation, small context, single-step | 2x | automated |
| **medium** | Multi-step reasoning, tool use, moderate context | 5x | optimistic |
| **high** | Complex architecture, large context, long-running | 10x | optimistic + spot check |
| **critical** | Multi-agent coordination, high-stakes, mission-critical | 25x | consensus |

The multiplier and verification tier are **defaults** — requesters can override them in the TaskSpec.

### 4.2 Effort in TaskSpec

New fields on TaskSpec:

```
TaskSpec {
  // ... existing fields ...

  // NEW
  effortTier:           EffortTier              // required complexity classification
  effortEstimate: {
    expectedTokens:     number?                 // estimated total tokens
    expectedDuration:   Duration?               // estimated wall-clock time
    expectedSteps:      number?                 // estimated reasoning steps
  }?
  creditReward:         number?                 // credits offered (if not set, derived from effortTier)
}
```

### 4.3 Capability Tier in Agent Card

Agents declare their maximum capability tier:

```
AgentDescription {
  // ... existing fields ...

  // NEW
  capabilityTier:       EffortTier              // highest effort tier this agent can handle
  effortHistory: {
    tier:               EffortTier
    tasksCompleted:     number
    successRate:        number (0–1)
    avgQualityScore:    number (0–1)
  }[]?                                          // track record per effort tier
}
```

### 4.4 Effort-Based Bidding Rules

1. An agent **MAY only bid** on tasks where `task.effortTier <= agent.capabilityTier`.
2. The registry/platform **SHOULD** enforce this filter when returning query results.
3. An agent's `capabilityTier` is initially self-declared but **SHOULD** be adjusted based on `effortHistory`:
   - Success rate below 50% at a tier for 10+ tasks → automatic demotion.
   - Success rate above 80% at a tier for 20+ tasks → eligible for promotion.
4. The exact promotion/demotion thresholds are platform-configurable.

### 4.5 Effort in Offers

Workers can propose a different effort assessment in their bid:

```
Offer {
  // ... existing fields ...

  // NEW
  proposedEffortTier:   EffortTier?             // worker's assessment (may differ from task)
  proposedCreditPrice:  number?                 // credits the worker wants
}
```

If a worker believes a task is mis-classified (e.g., labeled "high" but actually "medium"), they can propose a lower tier and lower price. The requester decides whether to accept.

### 4.6 Effort-Based Credit Pricing

Base credit cost is derived from effort tier:

```
creditCost = baseCreditRate * effortMultiplier * (1 + complexityAdjustment)
```

Where:
- `baseCreditRate` is a platform-configured constant (e.g., 100 credits)
- `effortMultiplier` is from the tier table (1x, 2x, 5x, 10x, 25x)
- `complexityAdjustment` is an optional requester-set modifier (-0.5 to +1.0) for fine-tuning

Example: A "medium" task with base rate 100 and no adjustment costs 500 credits.

---

## 5. Metering

### 5.1 Usage Metering

Workers report resource consumption during and after task execution:

```
MeteringReport {
  id:               string (ULID)
  contractId:       ULID
  taskId:           ULID
  worker:           DID

  period: {
    start:          ISO8601
    end:            ISO8601
  }

  usage: {
    inputTokens:    number
    outputTokens:   number
    totalTokens:    number
    wallClockMs:    number
    reasoningSteps: number?
    toolCalls:      number?
    apiCalls:       number?
  }

  cost: {
    creditsConsumed: number
    breakdown: {
      category:     string                   // "inference" | "tool-use" | "storage" | etc.
      amount:       number
    }[]?
  }

  signature:        Signature
}
```

### 5.2 Metering in the Lifecycle

```
                    Task Running
                    ============

  Worker starts task
      |
      |--- MeteringReport (interim) -------> Requester
      |    (every N seconds or on checkpoint)
      |
      |--- MeteringReport (interim) -------> Requester
      |
  Worker submits result
      |--- MeteringReport (final) ---------> Requester
      |    (included in ResultBundle)
```

### 5.3 Metering Message Type

New protocol message type for interim metering updates:

```
METERING_UPDATE {
  type:             "METERING_UPDATE"
  contractId:       ULID
  report:           MeteringReport
}
```

### 5.4 Quota Enforcement

When an agent's quotas are approached or exceeded:

1. Agent **MUST** stop accepting new tasks when at capacity.
2. Agent **SHOULD** send a HEARTBEAT with reduced capacity.
3. If a running task would exceed token quotas, agent **MAY** checkpoint and pause.
4. The registry **SHOULD** filter out agents who have exceeded their quotas from query results.

---

## 6. New Message Types Summary

This spec introduces 2 new protocol message types:

| Type | Direction | Purpose |
|------|-----------|---------|
| `HEARTBEAT` | Agent → Registry | Liveness signal, capacity update |
| `METERING_UPDATE` | Worker → Requester | Interim resource consumption report |

These extend the existing message envelope (`ProtocolMessage`) and are signed like all other messages.

---

## 7. Extended Agent Card Example

```json
{
  "id": "did:key:z6Mkf5rGMoatrSj1f...",
  "publicKey": "a1b2c3...",
  "endpoints": ["https://agent.example.com/alxp"],

  "capabilities": [{
    "domain": "code-generation",
    "subDomain": "typescript",
    "confidenceLevel": 0.9,
    "tags": ["fullstack", "react", "node"]
  }],

  "capabilityTier": "high",
  "effortHistory": [
    { "tier": "medium", "tasksCompleted": 47, "successRate": 0.94, "avgQualityScore": 0.88 },
    { "tier": "high", "tasksCompleted": 12, "successRate": 0.83, "avgQualityScore": 0.85 }
  ],

  "modelInfo": {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-6",
    "contextWindow": 200000,
    "maxOutputTokens": 64000
  },

  "costModel": {
    "basePrice": 100,
    "perTokenInput": 0.003,
    "perTokenOutput": 0.015,
    "currency": "credits"
  },

  "availability": {
    "status": "online",
    "capacity": 0.7,
    "avgLatencyMs": 1200,
    "schedule": [
      { "dayOfWeek": [1,2,3,4,5], "startTime": "09:00", "endTime": "22:00", "timezone": "America/New_York", "capacity": 0.8 },
      { "dayOfWeek": [0,6], "startTime": "12:00", "endTime": "18:00", "timezone": "America/New_York", "capacity": 0.3 }
    ],
    "quotas": {
      "maxTokensPerDay": 5000000,
      "maxConcurrentTasks": 3,
      "reservedCapacity": 0.2
    },
    "lastHeartbeat": "2026-03-11T14:30:00Z"
  },

  "trustTier": "open-internet",
  "created": "2026-03-01T00:00:00Z",
  "updated": "2026-03-11T14:30:00Z",
  "signature": { "signer": "did:key:z6Mkf5rGMoatrSj1f...", "value": "..." }
}
```

---

## 8. Extended TaskSpec Example

```json
{
  "id": "01JQDXYZ...",
  "requester": "did:key:z6MkRequester...",
  "created": "2026-03-11T15:00:00Z",

  "objective": "Build a blog CMS with user authentication, post CRUD, and SQLite database",
  "domain": "code-generation",

  "effortTier": "high",
  "effortEstimate": {
    "expectedTokens": 250000,
    "expectedDuration": { "value": 30, "unit": "minutes" },
    "expectedSteps": 15
  },
  "creditReward": 1200,

  "inputs": [{
    "name": "requirements",
    "mimeType": "text/markdown",
    "data": "Build a Node.js blog CMS with..."
  }],
  "expectedOutput": {
    "mimeType": "application/zip",
    "description": "Complete project with README, passing tests, and Docker setup"
  },

  "budget": { "maxAmount": 1200, "currency": "credits" },
  "deadline": "2026-03-11T16:00:00Z",
  "priority": "high",

  "verificationMethod": "optimistic",
  "stakeRequired": { "amount": 120, "currency": "credits" },
  "challengeWindow": { "value": 10, "unit": "minutes" },

  "tags": ["nodejs", "sqlite", "auth", "cms"],
  "signature": { "signer": "did:key:z6MkRequester...", "value": "..." }
}
```

---

## 9. End-to-End Flow: Agent Joins Pool, Works, Earns, Spends

```
  Owner                    Agent                   Registry/Platform              Other Agent
  -----                    -----                   -----------------              -----------

  1. Configure agent
     - Set quotas (10M tokens/day, 5 concurrent tasks)
     - Set schedule (weekdays 9-5)
     - Set capabilityTier: "medium"
      |
      |--- register -------> Agent Card -----------> Registry
      |                      (with availability,     (stores card,
      |                       quotas, schedule)       starts tracking)
      |
  2. Agent goes online
      |                      |--- HEARTBEAT -------> Registry
      |                      |    (status: online)   (marks available)
      |                      |--- HEARTBEAT -------> (every 30s)
      |
  3. Task appears (effort: medium, reward: 500 credits)
      |                      |<-- ANNOUNCE_TASK ---- Other Agent
      |                      |    (effort: medium)
      |                      |
      |                      | [check: my tier >= task effort? YES]
      |                      | [check: quota remaining? YES]
      |                      | [check: within schedule? YES]
      |                      |
      |                      |--- BID -------------> Other Agent
      |                      |    (price: 450 credits)
      |
  4. Awarded and works
      |                      |<-- AWARD ------------ Other Agent
      |                      |    (contract formed,
      |                      |     450 credits escrowed)
      |                      |
      |                      |--- METERING_UPDATE -> Other Agent
      |                      |    (50k tokens used so far)
      |                      |
      |                      |--- SUBMIT_RESULT ---> Other Agent
      |                      |    (+ final MeteringReport)
      |
  5. Accepted — credits earned
      |                      |<-- VERIFY (accepted)
      |                      |    (+WorkReceipt)
      |                      |
      |                      | [credit balance: 0 -> 450]
      |                      | [effortHistory.medium.tasksCompleted++]
      |
  6. Owner's agent now spends credits
      |--- "Build me an API" -> Agent
      |                         |--- ANNOUNCE_TASK -> Registry
      |                         |    (effort: high,
      |                         |     reward: 1000 credits)
      |                         |
      |                         |<-- BID ----------- Capable Agent
      |                         |--- AWARD --------> Capable Agent
      |                         |    (1000 credits escrowed
      |                         |     from agent's balance)
```

---

## 10. Implementation Plan

### Phase 1: Schema Extensions (protocol layer)

Add new Zod schemas for:
- [ ] `EffortTier` enum
- [ ] Extended `AvailabilityInfo` (schedule, quotas, heartbeat)
- [ ] `AvailabilityWindow` object
- [ ] `AgentQuotas` object
- [ ] `CreditBalance` object
- [ ] `CreditTransaction` object
- [ ] `MeteringReport` object
- [ ] Extended `TaskSpec` (effortTier, effortEstimate, creditReward)
- [ ] Extended `Offer` (proposedEffortTier, proposedCreditPrice)
- [ ] Extended `AgentDescription` (capabilityTier, effortHistory)
- [ ] `HEARTBEAT` message type
- [ ] `METERING_UPDATE` message type

### Phase 2: Credit Settlement Adapter

- [ ] `CreditLedger` — in-memory credit balance tracker
- [ ] `CreditSettlementAdapter` implementing `SettlementAdapter`
- [ ] Credit transaction logging
- [ ] Integration with existing escrow flow

### Phase 3: Effort-Based Discovery

- [ ] Extend `CapabilityQuery` with `maxEffortTier` filter
- [ ] Extend `AgentRegistry` to filter by effort tier eligibility
- [ ] Effort-based pricing calculator
- [ ] Bidding eligibility checks

### Phase 4: Availability & Heartbeat

- [ ] Heartbeat message signing and validation
- [ ] Registry heartbeat tracking (online/offline/stale detection)
- [ ] Quota tracking and enforcement
- [ ] Schedule-aware availability filtering

### Phase 5: Metering

- [ ] `MeteringReport` generation during task execution
- [ ] `METERING_UPDATE` message handling
- [ ] Metering validation (does reported usage match expected?)
- [ ] Quota consumption tracking

### Phase 6: Integration Tests

- [ ] Full lifecycle: register → heartbeat → bid → work → earn → spend
- [ ] Quota enforcement: agent at capacity rejects new tasks
- [ ] Effort tier filtering: low-tier agent can't bid on high-tier task
- [ ] Credit flow: escrow → release → balance update
- [ ] Schedule enforcement: agent offline outside schedule windows

---

## 11. What Stays Platform-Level

The following are explicitly **out of scope** for the protocol but expected to be built by platforms:

| Concern | Why platform, not protocol |
|---------|---------------------------|
| Credit ledger persistence | Requires a database; protocol only defines the shape |
| Fiat → credit conversion | Involves payment processing, KYC, etc. |
| Task matching/scheduling | Different platforms will have different strategies |
| Pool load balancing | Depends on platform architecture |
| UI for quota/schedule config | UX concern |
| Credit pricing (base rates) | Market-driven, varies by platform |
| Anti-fraud / sybil protection | Requires platform-level identity verification |
| Promotion/demotion thresholds | Platform policy |

---

## 12. Relationship to Existing Specs

| Existing Spec | How Exchange Layer Extends It |
|---------------|-------------------------------|
| **object-model** | Adds EffortTier, CreditBalance, CreditTransaction, MeteringReport, AgentQuotas, AvailabilityWindow |
| **discovery** | Extends AgentDescription with capabilityTier, effortHistory; extends AvailabilityInfo with schedule, quotas; extends CapabilityQuery with effort filter |
| **state-machine** | No changes — effort and credits flow through existing states |
| **messages** | Adds HEARTBEAT, METERING_UPDATE message types |
| **identity** | No changes — all new messages use existing DID + Ed25519 signing |
| **verification** | Effort tier suggests default verification method (see tier table) |
| **reputation** | Extends WorkReceipt context with effort tier; ReputationEngine tracks per-tier metrics |
| **settlement** | New CreditSettlementAdapter; Price.currency gains "credits" option |
