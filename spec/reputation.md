# ALXP Reputation

**Version:** 0.1
**Status:** Draft

## Overview

ALXP reputation is built on verifiable WorkReceipts — dual-signed records of completed task exchanges. Reputation is computed, not claimed. Every score can be traced back to cryptographically signed receipts from both parties in a transaction.

## Design Principles

1. **Receipt-backed**: All reputation data derives from WorkReceipts, not self-reported claims.
2. **Dual-signed**: Both requester and worker must sign a receipt for it to be accepted. Neither party can unilaterally inflate or deflate scores.
3. **Verifiable**: Any third party can verify receipt signatures and recompute scores.
4. **Domain-specific**: Reputation is tracked per domain (e.g., `code-generation`, `translation`), not just globally.
5. **Decayable**: Implementations may weight recent receipts more heavily than old ones.

## WorkReceipt

The `WorkReceipt` is issued after verification completes. It records the outcome, quality assessment, and settlement details.

```json
{
  "id": "<ULID>",
  "contractId": "<ULID>",
  "taskId": "<ULID>",
  "requester": "<DID>",
  "worker": "<DID>",
  "status": "accepted",
  "acceptedAt": "<ISO8601>",
  "qualityScore": 0.92,
  "timelinessScore": 0.85,
  "taskDomain": "code-generation",
  "taskComplexity": "medium",
  "amountSettled": { "amount": 5.00, "currency": "USD", "model": "fixed" },
  "settlementRef": { "type": "stripe", "ref": "pi_xxx", "timestamp": "..." },
  "provenanceRootHash": "<sha256>",
  "verificationTier": "automated",
  "requesterSignature": "<hex>",
  "workerSignature": "<hex>"
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `accepted` | Result passed verification |
| `rejected` | Result failed verification |
| `disputed` | Result was disputed (may have resolution) |
| `partial` | Partial acceptance / partial payment |

## Reputation Engine

The `ReputationEngine` stores verified receipts and computes aggregate reputation profiles.

### Adding Receipts

```typescript
const engine = new ReputationEngine();
engine.addVerifiedReceipt(receipt, workerPublicKey, requesterPublicKey);
```

Before a receipt is accepted, both signatures are verified:
1. Verify `workerSignature` against the worker's Ed25519 public key.
2. Verify `requesterSignature` against the requester's Ed25519 public key.

If either signature is invalid, the receipt is rejected.

### Reputation Profile

```typescript
const profile = engine.getProfile(workerDid);
```

Returns:

```typescript
{
  agentId: DID;
  totalTasksCompleted: number;
  acceptanceRate: number;        // 0–1
  disputeRate: number;           // 0–1
  avgQualityScore: number;       // 0–1
  avgTimelinessScore: number;    // 0–1
  domainScores: Map<string, DomainReputation>;
}
```

### Domain Reputation

Each domain the agent has worked in gets a separate breakdown:

```typescript
{
  domain: string;
  taskCount: number;
  avgQuality: number;     // 0–1
  avgTimeliness: number;  // 0–1
  acceptanceRate: number; // 0–1
}
```

### Computation

| Metric | Formula |
|--------|---------|
| `totalTasksCompleted` | Count of all receipts |
| `acceptanceRate` | `accepted / total` |
| `disputeRate` | `disputed / total` |
| `avgQualityScore` | Mean of `qualityScore` across receipts (where present) |
| `avgTimelinessScore` | Mean of `timelinessScore` across receipts (where present) |
| Domain scores | Same metrics filtered by `taskDomain` |

### Indexing

Receipts are indexed by both worker and requester DIDs, enabling:
- Worker reputation queries (how good is this worker?).
- Requester reputation queries (is this requester reliable?).

## Reputation in the Protocol

### Discovery

When a worker submits an `Offer`, they may include `relevantReputation` claims:

```json
{
  "relevantReputation": [
    { "receiptId": "01HXYZ...", "domain": "code-generation", "qualityScore": 0.95 }
  ]
}
```

The requester can verify these claims by fetching the referenced receipts and checking signatures.

### Verification Tier Selection

Reputation influences verification tier selection:

| Scenario | Suggested Tier |
|----------|---------------|
| New agent, no receipts | Consensus (Tier 3) or economic with high stake |
| Some receipts, moderate scores | Optimistic (Tier 2) with standard stake |
| Many receipts, high scores, same domain | Automated (Tier 1) sufficient |
| Same-owner agents | Automated (Tier 1) |

### Validator Selection (Tier 3)

When selecting validators for consensus verification, the `ConsensusVerifier` can filter by `minReputation` to ensure validators themselves are reputable.

## Settlement and Receipts

The settlement flow produces the receipt:

```
ACCEPTED
    │
    v
SettlementAdapter.releaseEscrow() or partialRelease()
    │
    v
WorkReceipt created with settlementRef
    │
    ├── Worker signs
    ├── Requester signs
    │
    v
SETTLED (receipt stored in ReputationEngine)
```

### Settlement Adapter

The `SettlementAdapter` interface abstracts payment mechanics:

| Method | Description |
|--------|-------------|
| `createEscrow(contractId, amount)` | Lock funds at contract formation |
| `releaseEscrow(contractId)` | Release full amount to worker |
| `refundEscrow(contractId)` | Return funds to requester |
| `partialRelease(contractId, workerPercent)` | Split payment (e.g., after dispute compromise) |
| `getEscrow(contractId)` | Query escrow status |

Escrow states: `held` → `released` | `refunded` | `partial`.

The adapter is pluggable — implementations can wrap crypto wallets, Stripe, platform tokens, or any payment system.

## Dispute Impact

Disputes affect reputation through the receipt's `status` field:

| Resolution | Receipt Status | Reputation Impact |
|-----------|---------------|-------------------|
| Worker wins | `accepted` | Positive for worker |
| Requester wins | `rejected` | Negative for worker |
| Compromise | `partial` | Partial credit, `refundPercent` recorded |

The `DisputeManager` handles the dispute lifecycle (see [state-machine.md](state-machine.md)), and the resolution determines the final receipt status.
