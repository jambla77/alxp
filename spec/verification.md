# ALXP Verification

**Version:** 0.1
**Status:** Draft

## Overview

ALXP uses a three-tier verification system to validate worker results. The tier is selected by the requester via `TaskSpec.verificationMethod`. Higher tiers provide stronger guarantees but cost more time and resources.

All results pass through Tier 1 (automated checks) first. If automated criteria exist and fail, the result is rejected immediately regardless of the chosen tier.

## Verification Flow

```
ResultBundle submitted
        │
        v
  ┌─────────────┐
  │   Tier 1     │   Always runs.
  │  Automated   │   Schema, hash, test suite, self-assessment.
  └──────┬───────┘
         │
    fail?──> REJECTED
         │
         │ pass
         v
  ┌──────────────────────────────────────────┐
  │  Route by verificationMethod:            │
  │                                          │
  │  "automated"  → done, return Tier 1      │
  │  "optimistic" → Tier 2 (economic)        │
  │  "consensus"  → Tier 3 (consensus)       │
  │  "proof"      → verify Merkle tree       │
  └──────────────────────────────────────────┘
```

## Tier 1: Automated Verification

Automated checks are deterministic and require no human or LLM judgment.

### Check Types

| Check | Trigger | Logic |
|-------|---------|-------|
| **Schema validation** | `acceptanceCriteria` includes `type: "schema"` | Validates output against a JSON Schema. For `text/plain` outputs, wraps the text in `{ "text": "..." }` before validation. |
| **Hash verification** | `acceptanceCriteria` includes `type: "hash"` | Computes SHA-256 of the canonicalized (JCS) output and compares against the expected hash. |
| **Test suite** | `acceptanceCriteria` includes `type: "test"` | Runs predefined test checks against each output. |
| **Self-assessment** | `ResultBundle.selfAssessment` is present | Checks that `selfAssessment.confidence >= 0.5`. |

### Test Suite Checks

The built-in test runner supports:

| Test Name | Behavior |
|-----------|----------|
| `json-valid` | Output data parses as valid JSON |
| `contains:<string>` | Output contains the literal string |
| `min-length:<n>` | Output length >= n characters |
| `max-length:<n>` | Output length <= n characters |
| `regex:<pattern>` | Output matches the regular expression |

### Automated Result

```typescript
{
  passed: boolean;            // All checks passed
  checks: Array<{
    name: string;             // Check identifier
    passed: boolean;
    details?: string;         // Failure explanation
  }>;
  score: number;              // 0–1, ratio of passed checks
  timestamp: string;          // ISO 8601
}
```

## Tier 2: Economic Verification (Optimistic)

Optimistic verification assumes results are correct unless challenged. It uses economic incentives (staking) to deter fraud.

### Flow

```
Tier 1 passes
      │
      v
  OptimisticVerifier.beginOptimisticAcceptance()
      │
      v
  PENDING_CHALLENGE state
      │
      ├── challenge window expires → ACCEPTED
      │
      └── Challenge raised (with stake)
              │
              v
          DISPUTED → arbitration
```

### Components

**OptimisticVerifier**: Manages the challenge window lifecycle.
- `beginOptimisticAcceptance(contract, result, challengeWindow)` — starts the window, records the deadline.
- `raiseChallenge(contractId, challenger, reason, evidence, challengerStake)` — validates the challenge is within the window and the challenger has staked.
- `finalizeAcceptance(contractId)` — called after the window closes with no challenge. Releases worker stake.
- `runSpotCheck(contractId, config)` — randomly selects results for re-verification. If a spot check fails, the worker's stake is slashed at `config.slashMultiplier`.

**StakingAdapter** (interface): Pluggable stake management.
- `lockStake(staker, amount)` → Stake
- `releaseStake(stakeId)` — return stake to staker.
- `slashStake(stakeId)` — forfeit stake.
- `getStake(stakeId)` → Stake

**MockStakingAdapter**: In-memory implementation for testing. Tracks balances, locked stakes, and allows fund provisioning.

### Spot Checks

The requester can configure random spot checks via `SpotCheckConfig`:

```json
{
  "probability": 0.1,
  "method": "automated-rerun",
  "slashMultiplier": 2.0
}
```

- `probability` (0–1): Chance any given result is spot-checked.
- `method`: `"automated-rerun"` | `"consensus"` | `"human"`.
- `slashMultiplier`: If the spot check fails, the slashed amount = `stake × multiplier`.

### Stake Lifecycle

```
lockStake() → status: "locked"
    │
    ├── challenge rejected → releaseStake() → "released"
    ├── challenge upheld   → slashStake()  → "slashed"
    └── no challenge       → releaseStake() → "released"
```

### Challenge Object

```json
{
  "id": "<ULID>",
  "contractId": "<ULID>",
  "resultId": "<ULID>",
  "challenger": "<DID>",
  "reason": "Output does not match specification",
  "evidence": ["..."],
  "challengerStake": { "amount": 10, "currency": "USD", "model": "fixed" },
  "created": "<ISO8601>",
  "windowExpires": "<ISO8601>",
  "status": "open",
  "signature": "<hex>"
}
```

## Tier 3: Consensus Verification

Multiple independent validators assess the result. The result passes if enough validators agree.

### Flow

```
Tier 1 passes
      │
      v
  ConsensusVerifier.verify()
      │
      ├── selectValidators(criteria) → k validators
      │
      ├── Each validator: assess(taskSpec, contract, result) → ValidatorAssessment
      │
      └── Aggregate: acceptanceRatio >= threshold?
              │
              ├── yes → ACCEPTED (consensus_passed)
              └── no  → REJECTED (consensus_failed)
```

### Validator Selection

Validators are chosen from a registered pool based on criteria:

| Criterion | Description |
|-----------|-------------|
| `count` | Number of validators needed |
| `minReputation` | Minimum reputation score (0–1) |
| `requiredDomain` | Must have expertise in this domain |
| `excludeParties` | Exclude the requester and worker from the pool |

### Validator Assessment

Each validator independently produces:

```json
{
  "validator": "<DID>",
  "contractId": "<ULID>",
  "resultId": "<ULID>",
  "accepted": true,
  "qualityScore": 0.87,
  "reasoning": "Output meets spec requirements...",
  "assessedAt": "<ISO8601>",
  "signature": "<hex>"
}
```

Validators do not see each other's assessments until all have submitted.

### Consensus Result

```json
{
  "id": "<ULID>",
  "contractId": "<ULID>",
  "resultId": "<ULID>",
  "validators": ["<DID>", ...],
  "assessments": [ ... ],
  "threshold": 0.67,
  "acceptanceRatio": 0.80,
  "averageQuality": 0.85,
  "passed": true,
  "completedAt": "<ISO8601>"
}
```

- `threshold`: The minimum acceptance ratio required (e.g., 0.67 = two-thirds).
- `acceptanceRatio`: Fraction of validators that accepted.
- `averageQuality`: Mean of all validators' quality scores.

## Proof Verification (Merkle Provenance)

When `verificationMethod: "proof"`, the worker must include a `MerkleProvenanceTree` in the `ResultBundle`. This proves the lineage of the result — which inputs were used, which tool calls were made, and which outputs were produced.

### Tree Structure

```
Root
 ├── Inputs branch
 │    ├── input-1 (hash of input data)
 │    └── input-2
 ├── Steps branch
 │    ├── tool-call-1 (hash of tool input + output)
 │    └── tool-call-2
 └── Outputs branch
      └── output-1 (hash of output data)
```

Each node has:
- `hash`: SHA-256 of canonicalized content (leaves) or concatenated child hashes (branches).
- `type`: `root` | `input` | `tool-call` | `intermediate` | `output` | `subtask` | `metadata`.
- `label`: Human-readable description.
- `children`: Child node hashes.
- `timestamp`: When the node was created.

### Verification

**Tree integrity** (`verifyTree`): For every non-leaf node, recompute the hash from children and verify it matches the stored hash. The root hash must match `rootHash`.

**Node inclusion** (`verifyInclusion`): Check that a specific node hash exists in the tree's node map.

### Subtask Provenance

For delegated subtasks, the sub-worker's Merkle root hash is included as a `subtask`-type leaf in the parent tree. This creates a recursive proof structure without requiring the parent to reveal the subtask's internal provenance.

## Unified Verification Engine

The `VerificationEngine` class routes verification through the appropriate tiers:

```typescript
const engine = new VerificationEngine(optimisticVerifier, consensusVerifier);
const result = await engine.verify(taskSpec, contract, resultBundle);
```

### Return Value

```typescript
{
  passed: boolean;
  decidingTier: "automated" | "economic" | "consensus" | "human";
  automatedResult: AutomatedVerificationResult;
  economicState?: { staked, challengeDeadline, challenged };
  consensusResult?: ConsensusResult;
  qualityScore: number;  // 0–1
}
```

## Verification Method Selection Guide

| Method | Trust Level | Cost | Latency | Use When |
|--------|-------------|------|---------|----------|
| `automated` | Low–Medium | None | Instant | Deterministic outputs, same-owner trust |
| `optimistic` | Medium–High | Stake required | Challenge window (e.g., 24h) | Repeated interactions, economic deterrence |
| `consensus` | High | Validator fees | Validator response time | High-value tasks, no prior relationship |
| `proof` | Medium | None | Instant | Auditability required, traceable provenance |
