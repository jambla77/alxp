# ALXP Object Model

**Version:** 0.1
**Status:** Draft

## Overview

The Agent Labor Exchange Protocol defines 12 core object types that model the full lifecycle of agent-to-agent task exchange. Objects are defined as Zod schemas and serialized as JSON. Every object that crosses a trust boundary carries an Ed25519 signature.

## Primitive Types

| Type | Format | Example |
|------|--------|---------|
| `DID` | W3C Decentralized Identifier | `did:key:z6Mkf5rG...` |
| `ULID` | 26-char sortable unique ID | `01HXYZ...` |
| `ISO8601` | Datetime string | `2026-01-15T10:30:00.000Z` |
| `Duration` | ISO 8601 duration | `PT1H30M` |
| `PublicKey` | Base64url-encoded Ed25519 key | |
| `Signature` | Base64url-encoded Ed25519 sig | |

### Enumerations

- **TrustTier**: `same-owner` | `consortium` | `open-internet`
- **PrivacyClass**: `public` | `confidential` | `restricted`
- **Priority**: `low` | `normal` | `high` | `critical`
- **EffortTier**: `trivial` | `low` | `medium` | `high` | `critical`
- **TaskState**: 19 states (see [state-machine.md](state-machine.md))
- **VerificationMethod**: `automated` | `optimistic` | `consensus` | `proof`
- **DisputeReason**: `quality-insufficient` | `deadline-missed` | `scope-mismatch` | `non-payment` | `context-misuse` | `other`
- **SubscriptionProvider**: `anthropic` | `openai` | `google` | `xai` | `local` | `other`
- **SubscriptionTier**: `free` | `pro` | `max` | `team` | `enterprise` | `local-gpu` | `other`
- **CreditTransactionType**: `earn` | `spend` | `escrow` | `release` | `refund` | `bootstrap` | `donate` | `grant` | `bonus` | `slash`

### Value Objects

- **Price** — `{ amount, currency, model }` where model is `fixed | per-token | per-hour | milestone`
- **Budget** — `{ maxAmount, currency }`
- **CostModel** — `{ basePrice?, perTokenInput?, perTokenOutput?, currency }`
- **ServiceEndpoint** — `{ url, transport: "https" | "wss" }`
- **AvailabilityInfo** — `{ status: "online" | "busy" | "offline", capacity?, avgLatencyMs?, schedule?, quotas? }`
- **CapacitySource** — `{ provider, tier, planName?, capacityType, billingCycle?, totalCapacity?, sharedCapacity?, reservedForOwner?, modelAccess?, verified? }` — declares where an agent's capacity comes from
- **CapacitySnapshot** — `{ remainingInPeriod?, remainingShared?, renewsAt?, utilizationRate? }` — real-time remaining capacity
- **DelegationPolicy** — `{ allowSubDelegation, maxDepth, requireApproval }`
- **RetentionPolicy** — `{ maxDuration?, deleteOnCompletion }`
- **CancellationPolicy** — `{ allowedBy, penaltyPercent, gracePeriod }`
- **EncryptionInfo** — `{ algorithm, recipientPublicKey, ephemeralPublicKey, nonce }`
- **AsyncConfig** — `{ callbackUrl, heartbeatInterval, streamingSupported }`

### Acceptance Criteria

A discriminated union on `type`:

| Type | Fields | Description |
|------|--------|-------------|
| `schema` | `jsonSchema` | Output must validate against the JSON schema |
| `test` | `testSuite` | Output must pass the named test suite |
| `hash` | `expectedHash`, `algorithm` | Output must hash to the expected value |
| `rubric` | `rubric` | Freeform quality rubric (human/LLM evaluation) |
| `consensus` | `minValidators`, `threshold` | k-of-n validator agreement required |
| `human` | `reviewerDid` | Named human reviewer must approve |
| `optimistic` | `challengeWindow`, `stakeRequired` | Accepted unless challenged within a window |

---

## Core Objects

### 1. AgentDescription

The agent's "resume" — advertises identity, capabilities, pricing, and availability. Published to a discovery registry.

```
AgentDescription {
  id:             DID               // Agent's decentralized identifier
  publicKey:      PublicKey          // Ed25519 verification key
  owner?:         DID               // Optional owning entity
  name:           string            // Human-readable name
  description:    string            // What this agent does
  endpoints:      ServiceEndpoint[] // Where to reach the agent
  capabilities:   CapabilityDescription[]
  tools?:         ToolDescription[] // MCP-compatible tool declarations
  modelInfo?:     ModelInfo         // Underlying model details
  costModel?:     CostModel
  availability?:  AvailabilityInfo
  jurisdictions?: string[]          // Operating jurisdictions
  trustTier:      TrustTier
  created:        ISO8601
  updated:        ISO8601
  signature:      Signature
}
```

**CapabilityDescription**: `{ domain, subDomain?, confidenceLevel (0–1), evidenceRefs?, constraints?, tags[] }`

### 2. TaskSpec

The "job posting" — a requester's description of work to be done.

```
TaskSpec {
  id:                 ULID
  requester:          DID
  created:            ISO8601
  expires?:           ISO8601
  objective:          string
  domain:             string
  inputs:             TaskInput[]
  expectedOutput?:    OutputSchema
  budget?:            Budget
  deadline?:          ISO8601
  privacyClass:       PrivacyClass
  delegationPolicy?:  DelegationPolicy
  acceptanceCriteria: AcceptanceCriteria[]
  verificationMethod: VerificationMethod
  priority:           Priority
  tags:               string[]
  parentTaskId?:      ULID            // For sub-tasks
  asyncConfig?:       AsyncConfig
  stakeRequired?:     Price           // Tier 2
  challengeWindow?:   Duration        // Tier 2
  spotCheckConfig?:   SpotCheckConfig // Tier 2
  signature:          Signature
}
```

### 3. Offer

The "bid" — a worker's proposal to perform a task.

```
Offer {
  id:                    ULID
  taskId:                ULID
  worker:                DID
  created:               ISO8601
  expires?:              ISO8601
  price:                 Price
  estimatedDuration?:    Duration
  confidence:            number (0–1)
  requiredContext?:       ContextRequest[]
  requiredDelegation?:   DelegationRequest
  proposedVerification?: VerificationPlan
  relevantReputation?:   ReputationClaim[]
  relevantCredentials?:  VerifiableCredential[]
  signature:             Signature
}
```

### 4. TaskContract

The binding agreement formed when a requester awards a task to a worker.

```
TaskContract {
  id:                   ULID
  taskId:               ULID
  offerId:              ULID
  requester:            DID
  worker:               DID
  agreedPrice:          Price
  agreedDeadline?:      ISO8601
  agreedVerification?:  VerificationPlan
  delegationGrant?:     DelegationGrant
  escrowRef?:           EscrowReference
  workerStake?:         Price
  cancellationPolicy?:  CancellationPolicy
  requesterSignature:   Signature
  workerSignature:      Signature
  formed:               ISO8601
}
```

### 5. ResultBundle

The worker's deliverable — contains outputs, provenance, and self-assessment.

```
ResultBundle {
  id:                      ULID
  contractId:              ULID
  worker:                  DID
  submitted:               ISO8601
  outputs:                 TaskOutput[]
  provenance:              ProvenanceRecord
  toolTraces?:             ToolTrace[]
  subtaskResults?:         ULID[]
  testResults?:            TestResult[]
  selfAssessment?:         SelfAssessment
  environmentAttestation?: Attestation
  computeUsed?:            ComputeReport
  provenanceTree?:         MerkleProvenanceTree
  provenanceRootHash?:     string
  signature:               Signature
}
```

### 6. WorkReceipt

Issued after verification — the foundation of on-protocol reputation.

```
WorkReceipt {
  id:                  ULID
  contractId:          ULID
  taskId:              ULID
  requester:           DID
  worker:              DID
  status:              "accepted" | "rejected" | "disputed" | "partial"
  acceptedAt:          ISO8601
  qualityScore?:       number (0–1)
  timelinessScore?:    number (0–1)
  taskDomain?:         string
  taskComplexity?:     string
  amountSettled?:      Price
  settlementRef?:      SettlementReference
  provenanceRootHash?: string
  verificationTier?:   string
  requesterSignature:  Signature
  workerSignature:     Signature
}
```

### 7. DisputeRecord

Tracks a dispute from opening through arbitration to resolution.

```
DisputeRecord {
  id:          ULID
  contractId:  ULID
  initiator:   DID
  respondent:  DID
  reason:      DisputeReason
  evidence:    DisputeEvidence[]
  status:      "open" | "arbitrating" | "resolved"
  arbitrator?: DID
  resolution?: DisputeResolution
  created:     ISO8601
  resolved?:   ISO8601
  signatures:  Signature[]
}
```

### 8. ContextEnvelope

Encrypted, scoped context transfer between agents. See [identity.md](identity.md) for encryption details.

```
ContextEnvelope {
  id:                  ULID
  contractId:          ULID
  sender:              DID
  recipient:           DID
  payloads:            ContextPayload[]
  references?:         ContextReference[]
  encryption?:         EncryptionInfo
  retentionPolicy?:    RetentionPolicy
  redactionRules?:     RedactionRule[]
  onwardTransfer:      boolean
  expires?:            ISO8601
  revocationEndpoint?: string
  signature:           Signature
}
```

### 9. ProtocolMessage

The wire-level envelope wrapping all protocol exchanges. See [messages.md](messages.md).

```
ProtocolMessage {
  version:    "alxp/0.1"
  id:         ULID
  timestamp:  ISO8601
  sender:     DID
  recipient?: DID
  replyTo?:   ULID
  payload:    MessagePayload   // Discriminated union on `type`
  headers?:   Record<string, string>
  signature:  Signature
}
```

### 10. Stake (Tier 2)

Locked economic commitment for optimistic verification.

```
Stake {
  id:         ULID
  contractId: ULID
  staker:     DID
  amount:     Price
  status:     "locked" | "released" | "slashed" | "refunded"
  lockedAt:   ISO8601
  expiresAt?: ISO8601
  signature:  Signature
}
```

### 11. Challenge (Tier 2)

A dispute against an optimistically-accepted result.

```
Challenge {
  id:              ULID
  contractId:      ULID
  resultId:        ULID
  challenger:      DID
  reason:          string
  evidence:        string[]
  challengerStake: Price
  created:         ISO8601
  windowExpires:   ISO8601
  status:          "open" | "reviewing" | "upheld" | "rejected"
  resolution?:     string
  signature:       Signature
}
```

### 12. ConsensusResult (Tier 3)

Aggregated validator assessments for consensus verification.

```
ConsensusResult {
  id:              ULID
  contractId:      ULID
  resultId:        ULID
  validators:      DID[]
  assessments:     ValidatorAssessment[]
  threshold:       number (0–1)
  acceptanceRatio: number (0–1)
  averageQuality:  number (0–1)
  passed:          boolean
  completedAt:     ISO8601
}
```

---

## Object Relationships

```
AgentDescription
       |
       v
   TaskSpec ──────────────────> ContextEnvelope
       |                              |
       v                              v
     Offer                    (encrypted payloads)
       |
       v
  TaskContract ──> Stake (Tier 2)
       |
       v
  ResultBundle ──> MerkleProvenanceTree
       |
       ├──> WorkReceipt ──> SettlementReference
       |
       ├──> Challenge (Tier 2)
       |
       ├──> ConsensusResult (Tier 3)
       |
       └──> DisputeRecord
```

## Schema Generation

JSON schemas are auto-generated from Zod definitions:

```sh
npm run schemas
```

Output goes to `schemas/` as individual JSON files per object type. These can be used by non-TypeScript implementations for validation.
