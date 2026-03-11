# ALXP Task State Machine

**Version:** 0.1
**Status:** Draft

## Overview

Every task in ALXP follows a deterministic state machine. The `TaskStateMachine` enforces all transitions, tracks history, and validates that required signatures are present before allowing a state change.

## States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `POSTED` | Task published, awaiting offers | No |
| `BIDDING` | At least one offer received | No |
| `AWARDED` | Requester accepted an offer, contract formed | No |
| `RUNNING` | Worker is executing the task | No |
| `CHECKPOINT` | Worker reported intermediate progress | No |
| `BLOCKED` | Worker needs additional input from requester | No |
| `SUBMITTED` | Worker delivered a ResultBundle | No |
| `REVIEWING` | Requester is evaluating the result | No |
| `PENDING_CHALLENGE` | Optimistic acceptance, awaiting challenge window (Tier 2) | No |
| `VALIDATING` | Consensus validators are assessing the result (Tier 3) | No |
| `ACCEPTED` | Result passed verification | No |
| `REJECTED` | Result failed verification | No |
| `DISPUTED` | One party raised a dispute | No |
| `ARBITRATING` | Dispute is under arbitration | No |
| `SETTLED` | Payment released, receipts issued | Yes |
| `RESOLVED` | Dispute arbitration concluded | Yes |
| `CANCELLED` | Requester cancelled the task | Yes |
| `EXPIRED` | Deadline lapsed without completion | Yes |
| `FAILED` | Worker reported inability to complete | Yes |

## Transitions

### Happy Path

```
POSTED ──first_offer_received──> BIDDING
BIDDING ──offer_accepted[R,W]──> AWARDED
AWARDED ──context_transferred[R]──> RUNNING
RUNNING ──result_submitted[W]──> SUBMITTED
SUBMITTED ──review_started[R]──> REVIEWING
REVIEWING ──result_accepted[R]──> ACCEPTED
ACCEPTED ──payment_released[R,W]──> SETTLED
```

### Progress & Blocking

```
RUNNING ──progress_report[W]──> CHECKPOINT
CHECKPOINT ──checkpoint_acknowledged──> RUNNING

RUNNING ──input_needed[W]──> BLOCKED
BLOCKED ──input_provided[R]──> RUNNING
```

### Rejection & Disputes

```
REVIEWING ──result_rejected[R]──> REJECTED
REJECTED ──partial_payment[R,W]──> SETTLED

REVIEWING ──dispute_raised[W]──> DISPUTED
DISPUTED ──arbitration_started──> ARBITRATING
ARBITRATING ──arbitration_complete──> RESOLVED
```

### Tier 2: Optimistic Verification

```
REVIEWING ──optimistic_accepted[R]──> PENDING_CHALLENGE
PENDING_CHALLENGE ──challenge_window_closed──> ACCEPTED
PENDING_CHALLENGE ──challenge_raised──> DISPUTED
```

When the task uses `verificationMethod: "optimistic"`, the result enters a challenge window after initial acceptance. If no challenge is raised before the window expires, the result is fully accepted. Any party may raise a challenge by posting a `Challenge` object (with stake).

### Tier 3: Consensus Verification

```
REVIEWING ──consensus_requested[R]──> VALIDATING
VALIDATING ──consensus_passed──> ACCEPTED
VALIDATING ──consensus_failed──> REJECTED
```

When using `verificationMethod: "consensus"`, the result is sent to k independent validators. If the acceptance ratio meets the threshold, the result passes.

### Cancellation

```
POSTED ──cancelled[R]──> CANCELLED
BIDDING ──cancelled[R]──> CANCELLED
AWARDED ──cancelled[R]──> CANCELLED
RUNNING ──cancelled[R]──> CANCELLED
```

Only the requester may cancel. Cancellation from `AWARDED` or `RUNNING` may trigger penalties per the `CancellationPolicy` in the contract.

### Expiration

```
POSTED ──expired──> EXPIRED
BIDDING ──expired──> EXPIRED
RUNNING ──expired──> EXPIRED
```

Expiration is triggered automatically when the task's deadline passes. No signature is required.

### Failure

```
RUNNING ──worker_failed[W]──> FAILED
BLOCKED ──worker_failed[W]──> FAILED
```

The worker self-reports inability to complete the task. Stake disposition depends on the failure reason and contract terms.

## Signature Legend

- `[R]` — requires requester signature
- `[W]` — requires worker signature
- `[R,W]` — requires both signatures
- (no annotation) — no signature required (system/timer trigger)

## State Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │              CANCELLATION ZONE                │
                    │  POSTED ─> BIDDING ─> AWARDED ─> RUNNING    │──cancelled──> CANCELLED
                    └──────────────────────────────────────────────┘
                                                      │
                                      ┌───────────────┼───────────────┐
                                      v               v               v
                                 CHECKPOINT        BLOCKED        SUBMITTED
                                      │               │               │
                                      └───────┐   ┌───┘               v
                                              v   v              REVIEWING
                                            RUNNING                   │
                                                          ┌───────────┼───────────────┐
                                                          v           v               v
                                              PENDING_CHALLENGE   VALIDATING    result_accepted
                                                   │      │       │       │           │
                                                   v      v       v       v           v
                                              ACCEPTED DISPUTED ACCEPTED REJECTED  ACCEPTED
                                                   │      │       │       │           │
                                                   v      v       v       v           v
                                               SETTLED ARBITRATING  └─────┘──>    SETTLED
                                                          │
                                                          v
                                                       RESOLVED
```

## Implementation

The `TaskStateMachine` class:

- **Constructor**: `new TaskStateMachine(taskId, requester, worker?, initialState?)`
- **`transition(trigger, signers)`**: Applies the trigger. Throws `InvalidTransitionError` if invalid, or `Error` if required signatures are missing.
- **`canTransition(trigger)`**: Returns `boolean` without modifying state.
- **`validTriggers()`**: Returns all `TransitionDef` objects valid from the current state.
- **`isTerminal()`**: Returns `true` if in `SETTLED | CANCELLED | EXPIRED | FAILED | RESOLVED`.
- **`history`**: Array of `{ from, to, trigger, timestamp }` entries.

## Invariants

1. A task in a terminal state has no valid outgoing transitions.
2. Every transition that changes economic state (contract formation, payment) requires dual signatures.
3. System-triggered transitions (expiration, challenge window close) require no signatures.
4. The state machine enforces the same rules regardless of transport — it is protocol-layer, not transport-layer.
