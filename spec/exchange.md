# ALXP Exchange Layer — Capacity Sharing Network, Credit Economy & Effort Levels

> **Status:** Draft v0.2
> **Date:** 2026-03-11
> **Depends on:** object-model, discovery, state-machine, messages, reputation, verification

## 1. Overview

This specification defines the **exchange layer** — the set of protocol primitives that enable agents to share unused subscription capacity, earn and spend credits, and match tasks to capable agents using effort levels. It builds on top of the existing ALXP core (identity, discovery, lifecycle, verification, reputation) without breaking changes.

ALXP is a **capacity sharing network**, not an API marketplace. Most people already pay for AI subscriptions (Claude Pro/Max, ChatGPT Plus, Gemini Advanced, etc.) but don't use all their capacity. ALXP lets them share that unused capacity — costing them nothing extra — and earn credits they can spend to access other people's capacity when they need a different model.

### Design Principles

1. **Protocol, not platform** — Define primitives and wire formats; leave ledger implementation, matching algorithms, and UX to platforms.
2. **Share, don't sell** — The primary way to earn credits is by donating unused subscription capacity. Credits can also be bootstrapped (sign-up grants) or earned through work. The protocol is agnostic to the source.
3. **Meritocratic, not credential-based** — Effort-level eligibility is based on demonstrated track record, not model identity.
4. **Incremental adoption** — Every feature in this spec is optional. Existing ALXP deployments continue to work without exchange layer support.
5. **Capacity-aware** — Agents declare their subscription source, capacity limits, and what they're willing to share. Discovery queries can filter by provider, model access, and remaining capacity.

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
    capacityRemaining: number?               // remaining shared capacity in billing period
    periodRenewsAt:   ISO8601?               // when the billing period resets
  }
  capacitySnapshot: {                        // real-time capacity availability
    remainingInPeriod: number?               // total remaining in billing period
    remainingShared:   number?               // remaining capacity available to share
    renewsAt:          ISO8601?
    utilizationRate:   number? (0–1)         // how much of plan they typically use
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

## 3. Credit Economy — Capacity Time Bank

### 3.1 Credits as Capacity Currency

A **credit** is the protocol's abstract unit of account, functioning as a **capacity time bank**. You earn credits by donating unused subscription capacity; you spend credits to consume others' capacity. The protocol does not define a fixed exchange rate to fiat or crypto — that is a platform concern.

```
CreditBalance {
  agentId:          DID
  available:        number                   // credits available to spend
  escrowed:         number                   // credits locked in active tasks
  earned:           number                   // lifetime credits earned from work
  spent:            number                   // lifetime credits spent on tasks
  bootstrapped:     number                   // lifetime credits from bootstrap grants
  donated:          number                   // lifetime capacity-hours donated
  consumed:         number                   // lifetime capacity-hours consumed
  lastUpdated:      ISO8601
}
```

### 3.2 How Credits are Acquired

| Method | Description | Primary? |
|--------|-------------|----------|
| **Donate** | Share unused subscription capacity (Claude, OpenAI, Gemini, local GPU). Credits proportional to capacity donated. | **Yes** |
| **Work** | Complete tasks for other agents. Credits are released from escrow on acceptance. | Yes |
| **Bootstrap** | Initial credit grant to seed a new agent's balance (sign-up bonus, etc.). | Secondary |
| **Grant** | Receive credits from another agent (e.g., pool revenue sharing). | Secondary |
| **Bonus** | Platform-issued credits (referral, milestone, etc.). | Secondary |

The **primary** way to earn credits is by donating unused subscription capacity. This is the core economic model: people already pay for AI subscriptions but don't use all their capacity. ALXP lets them share that unused capacity and earn credits they can spend to access other people's capacity when they need a different model.

### 3.3 Credit Transactions

Every credit movement is recorded as a transaction:

```
CreditTransaction {
  id:               string (ULID)
  agentId:          DID
  type:             "earn" | "spend" | "escrow" | "release" | "refund" | "bootstrap" | "donate" | "grant" | "bonus" | "slash"
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

### 4.3 Capability Tier and Capacity Source in Agent Card

Agents declare their maximum capability tier and where their capacity comes from:

```
AgentDescription {
  // ... existing fields ...

  // NEW — Effort tier
  capabilityTier:       EffortTier              // highest effort tier this agent can handle
  effortHistory: {
    tier:               EffortTier
    tasksCompleted:     number
    successRate:        number (0–1)
    avgQualityScore:    number (0–1)
  }[]?                                          // track record per effort tier

  // NEW — Capacity sharing
  capacitySource: {
    provider:           "anthropic" | "openai" | "google" | "xai" | "local" | "other"
    tier:               "free" | "pro" | "max" | "team" | "enterprise" | "local-gpu" | "other"
    planName:           string?                 // "Claude Max", "ChatGPT Plus", etc.
    capacityType:       "tokens" | "messages" | "compute-minutes" | "unlimited-local"
    billingCycle: {
      renewsAt:         ISO8601?
      periodDays:       number?
    }?
    totalCapacity:      number?                 // total in billing period
    sharedCapacity:     number?                 // amount willing to share
    reservedForOwner:   number?                 // amount reserved for owner's own use
    modelAccess:        string[]?               // ["claude-sonnet-4", "claude-opus-4"]
    verified:           boolean?                // future: proof of subscription
  }?

  capacitySnapshot: {
    remainingInPeriod:  number?
    remainingShared:    number?
    renewsAt:           ISO8601?
    utilizationRate:    number? (0–1)           // how much of plan they typically use
  }?
}
```

The `capacitySource` tells other agents what kind of compute backs this agent. This enables capacity-aware discovery: "find me an agent backed by Claude Opus" or "find me the cheapest capacity (local GPU)".

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
  capacitySource:       CapacitySource?         // what capacity backs this offer
}
```

If a worker believes a task is mis-classified (e.g., labeled "high" but actually "medium"), they can propose a lower tier and lower price. The requester decides whether to accept.

### 4.6 Effort-Based Credit Pricing

Base credit cost is derived from effort tier and provider:

```
creditCost = baseCreditRate * effortMultiplier * (1 + complexityAdjustment) * providerTierMultiplier
```

Where:
- `baseCreditRate` is a platform-configured constant (e.g., 100 credits)
- `effortMultiplier` is from the tier table (1x, 2x, 5x, 10x, 25x)
- `complexityAdjustment` is an optional requester-set modifier (-0.5 to +1.0) for fine-tuning
- `providerTierMultiplier` adjusts for the value of the capacity source (Claude Opus capacity is worth more credits than local Ollama)

Default provider tier multipliers:

| Provider:Tier | Multiplier | Rationale |
|---------------|------------|-----------|
| `anthropic:max` | 1.5x | Premium models, high capacity |
| `anthropic:pro` | 1.2x | Good models, moderate capacity |
| `openai:pro` | 1.2x | GPT-4 class models |
| `local:local-gpu` | 0.7x | Free to run, lower capability ceiling |
| `local:free` | 0.5x | Open models, no subscription cost |
| _(default)_ | 1.0x | Unknown or unspecified provider |

Example: A "medium" task on Claude Max costs `100 * 5 * 1.0 * 1.5 = 750` credits. The same task on a local GPU costs `100 * 5 * 1.0 * 0.7 = 350` credits.

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
    capacityConsumed: number?                // capacity units consumed from provider
    sourceProvider:   SubscriptionProvider?   // which provider's capacity was used
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

  "capacitySource": {
    "provider": "anthropic",
    "tier": "max",
    "planName": "Claude Max",
    "capacityType": "messages",
    "totalCapacity": 1000,
    "sharedCapacity": 500,
    "reservedForOwner": 500,
    "modelAccess": ["claude-sonnet-4", "claude-opus-4"],
    "verified": false
  },

  "capacitySnapshot": {
    "remainingInPeriod": 800,
    "remainingShared": 400,
    "renewsAt": "2026-04-01T00:00:00Z",
    "utilizationRate": 0.2
  },

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

## 9. End-to-End Flow: Share Capacity, Earn Credits, Use Others' Models

This example shows Alice (Claude Max subscriber, ~80% unused capacity) and Bob (RTX 4090 owner running Ollama):

```
  Alice (Claude Max)          Registry/Platform           Bob (RTX 4090 + Ollama)
  ------------------          -----------------           -----------------------

  1. Register with capacity source
      |--- Agent Card -----------> Registry
      |    capacitySource:         (stores card)
      |      provider: anthropic
      |      tier: max
      |      sharedCapacity: 500
      |
      |                                                     |--- Agent Card ------->
      |                                                     |    capacitySource:
      |                                                     |      provider: local
      |                                                     |      tier: local-gpu
      |                                                     |      capacityType: unlimited-local

  2. Donate unused capacity → earn credits
      |--- donate(1000) --------> Ledger
      |    "Shared 50% of Claude Max"
      |    [balance: 0 → 1000]
      |                                                     |--- donate(500) ----->
      |                                                     |    "Shared GPU time"
      |                                                     |    [balance: 0 → 500]

  3. Alice needs a fast draft (uses Bob's local GPU)
      |--- discover(preferredProvider: local) --> Registry
      |<-- Bob's card -------------------------
      |
      |--- ANNOUNCE_TASK (effort: medium) -----> Bob
      |<-- BID (350 credits) ------------------- Bob
      |--- AWARD (350 credits escrowed) -------> Bob
      |                                                     |--- work (local Llama) --->
      |<-- SUBMIT_RESULT ---------------------------------- Bob
      |--- VERIFY (accepted) -----------------> Bob
      |    [Alice: 1000 → 650]                              [Bob: 500 → 850]

  4. Bob needs Claude polish (uses Alice's Claude capacity)
      |                                                     |--- discover(provider: anthropic)
      |<-- ANNOUNCE_TASK (effort: medium) --- Bob
      |--- BID (750 credits) ----------------> Bob          |    (Claude Max costs more)
      |<-- AWARD (750 credits escrowed) ----- Bob
      |--- work (Claude Opus) ------->
      |--- SUBMIT_RESULT ------------------>  Bob
      |<-- VERIFY (accepted) --------------- Bob
      |    [Alice: 650 → 1400]                              [Bob: 850 → 100]

  Result: Nobody paid extra money. Both used capacity they already had.
  Alice: donated 1000, earned 750, spent 350 → 1400 available
  Bob:   donated 500,  earned 350, spent 750 → 100 available
```

---

## 10. Implementation Plan

All phases are complete in the reference implementation.

### Phase 1: Schema Extensions (protocol layer) — COMPLETE

- [x] `EffortTier` enum, `SubscriptionProvider`, `SubscriptionTier`
- [x] `CapacitySource`, `CapacitySnapshot` objects
- [x] Extended `AvailabilityInfo` (schedule, quotas, heartbeat)
- [x] `CreditBalance` with `bootstrapped`, `donated`, `consumed` fields
- [x] `CreditTransaction` with `bootstrap` and `donate` types
- [x] `MeteringReport` with `capacityConsumed` and `sourceProvider`
- [x] Extended `AgentDescription` (capacitySource, capacitySnapshot)
- [x] Extended `TaskSpec` (preferredProvider, acceptLocalModels)
- [x] Extended `Offer` (capacitySource)
- [x] Extended `Heartbeat` (capacitySnapshot)
- [x] Extended `QuotaRemaining` (capacityRemaining, periodRenewsAt)

### Phase 2: Credit Settlement Adapter — COMPLETE

- [x] `CreditLedger.bootstrap()` (replaces purchase)
- [x] `CreditLedger.donate()` — records capacity donation
- [x] Deprecated `purchase()` alias for backward compatibility
- [x] Balance tracking with `bootstrapped`, `donated`, `consumed`

### Phase 3: Capacity-Aware Discovery — COMPLETE

- [x] `CapabilityQuery` with `preferredProvider`, `acceptLocalModels`, `minRemainingCapacity`
- [x] `matchesQuery()` filters by provider, local models, remaining capacity
- [x] Provider-aware pricing (`PROVIDER_TIER_MULTIPLIERS`)
- [x] `generateAgentCard()` includes `capacitySource` and `capacitySnapshot`
- [x] `hasRemainingCapacity()` helper for heartbeat state

### Phase 4: Availability & Heartbeat — COMPLETE

- [x] `HeartbeatState` extended with `capacitySnapshot`
- [x] `recordHeartbeat()` captures capacity snapshot
- [x] All existing heartbeat tracking preserved

### Phase 5: Metering — COMPLETE

- [x] `MeteringTracker.startSession()` accepts `sourceProvider`
- [x] Generated reports include `capacityConsumed` and `sourceProvider`

### Phase 6: Integration Tests — COMPLETE

- [x] 347 tests across 24 test files
- [x] Capacity sharing lifecycle test (donate → earn → spend)
- [x] Provider-based discovery filtering
- [x] Provider-aware pricing tests
- [x] Heartbeat with capacity snapshot

---

## 11. What Stays Platform-Level

The following are explicitly **out of scope** for the protocol but expected to be built by platforms:

| Concern | Why platform, not protocol |
|---------|---------------------------|
| Credit ledger persistence | Requires a database; protocol only defines the shape |
| Subscription verification | Proving you actually have a Claude Max plan requires OAuth/API integration |
| Capacity measurement | Tracking exact remaining capacity requires provider-specific API calls |
| Task matching/scheduling | Different platforms will have different strategies |
| Pool load balancing | Depends on platform architecture |
| UI for capacity sharing config | UX concern |
| Credit pricing (base rates) | Market-driven, varies by platform |
| Anti-fraud / capacity fraud | Requires platform-level verification (see threat model) |
| Promotion/demotion thresholds | Platform policy |

---

## 12. Relationship to Existing Specs

| Existing Spec | How Exchange Layer Extends It |
|---------------|-------------------------------|
| **object-model** | Adds SubscriptionProvider, SubscriptionTier, CapacitySource, CapacitySnapshot, EffortTier, CreditBalance (with bootstrapped/donated/consumed), CreditTransaction (bootstrap/donate types) |
| **discovery** | Extends AgentDescription with capacitySource, capacitySnapshot; extends CapabilityQuery with preferredProvider, acceptLocalModels, minRemainingCapacity; provider-aware pricing |
| **state-machine** | No changes — capacity sharing and credits flow through existing states |
| **messages** | Adds HEARTBEAT (with capacitySnapshot), METERING_UPDATE (with capacityConsumed, sourceProvider) |
| **identity** | No changes — all new messages use existing DID + Ed25519 signing |
| **verification** | Effort tier suggests default verification method (see tier table) |
| **reputation** | Extends WorkReceipt context with effort tier; ReputationEngine tracks per-tier metrics |
| **settlement** | CreditLedger with bootstrap()/donate(); CreditSettlementAdapter |
| **threat-model** | New threats: capacity fraud, free-riding |
