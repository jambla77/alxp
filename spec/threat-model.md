# ALXP Threat Model

**Version:** 0.1
**Status:** Draft

## Overview

This document identifies threats to ALXP participants and describes the protocol's mitigations. ALXP operates across trust boundaries — agents may be operated by different entities with conflicting incentives. The protocol is designed to be safe in the `open-internet` trust tier, with progressively lighter defenses for `consortium` and `same-owner` scenarios.

## Threat Actors

| Actor | Description |
|-------|-------------|
| **Malicious worker** | Submits low-quality or fabricated results, attempts to collect payment without doing real work |
| **Malicious requester** | Refuses to pay for valid work, extracts labor without settlement |
| **Malicious validator** | Colludes with worker or requester to bias consensus verification |
| **Impersonator** | Creates fake identities or forges messages to impersonate legitimate agents |
| **Eavesdropper** | Intercepts context or results in transit to steal proprietary data |
| **Sybil attacker** | Creates many fake identities to manipulate reputation or consensus |

## Threat Categories

### 1. Identity and Authentication

#### T1.1: Identity Spoofing

**Threat**: An attacker creates a message claiming to be from another agent.

**Mitigation**: Every `ProtocolMessage` is signed with the sender's Ed25519 private key. The signature covers the canonicalized message content. Receivers verify the signature against the sender's public key, which is embedded in their `did:key` DID. Spoofing requires possession of the victim's private key.

#### T1.2: DID Key Compromise

**Threat**: An agent's Ed25519 private key is stolen.

**Mitigation**: Key compromise is outside the protocol scope — it depends on the agent's operational security. However, ALXP limits blast radius through:
- UCAN token expiration (compromised delegations expire).
- Context envelope expiration and revocation endpoints.
- Receipts are dual-signed, so a single compromised key cannot fabricate complete reputation records.

**Residual risk**: A compromised key allows impersonation until the key is rotated. ALXP does not yet define a key rotation mechanism.

#### T1.3: Replay Attacks

**Threat**: An attacker captures a valid signed message and re-sends it.

**Mitigation**: Each message has a unique ULID `id` and `timestamp`. Receivers should track seen message IDs and reject duplicates. UCAN tokens include a `nnc` (nonce) field for replay protection.

### 2. Result Integrity

#### T2.1: Fabricated Results

**Threat**: A worker submits results they did not actually compute (e.g., copied from another source, random data).

**Mitigations** (layered by tier):
- **Tier 1**: Automated checks (schema validation, hash verification, test suites) catch structurally invalid results.
- **Tier 2**: Economic stake — the worker locks funds that are slashed if a challenge succeeds. Spot checks randomly re-verify results.
- **Tier 3**: Independent validators assess the result. Collusion requires corrupting k-of-n validators.
- **Proof**: Merkle provenance trees trace the result back to inputs and tool calls. Fabrication requires forging the entire provenance chain.

#### T2.2: Result Tampering in Transit

**Threat**: A result is modified between submission and verification.

**Mitigation**: The `ResultBundle` is signed by the worker. Any modification invalidates the signature. The `provenanceRootHash` provides an additional integrity check.

#### T2.3: Provenance Forgery

**Threat**: A worker constructs a fake Merkle provenance tree that doesn't reflect actual computation.

**Mitigation**: Merkle tree verification checks structural integrity (all hashes are consistent). However, the protocol cannot prove that the tree reflects *actual* computation — only that it is internally consistent. Tier 2 (spot checks with re-execution) and Tier 3 (independent validators) provide stronger guarantees against this attack.

**Residual risk**: A determined worker can construct a plausible but fabricated provenance tree. The protocol relies on economic incentives and consensus to make this unprofitable.

### 3. Economic Attacks

#### T3.1: Free-Riding Requester

**Threat**: A requester receives valid work but refuses to release payment.

**Mitigations**:
- Escrow: Funds are locked at contract formation via the `SettlementAdapter`. The requester cannot withdraw escrowed funds unilaterally.
- Dispute mechanism: The worker can raise a dispute, triggering arbitration.
- Reputation: Non-payment is recorded in receipts, degrading the requester's reputation.

#### T3.2: Stake Manipulation

**Threat**: A worker with low stake has little to lose from submitting garbage.

**Mitigation**: The requester sets `stakeRequired` in the `TaskSpec`. Workers who cannot meet the stake requirement cannot bid. The `slashMultiplier` in spot check configuration can impose penalties exceeding the original stake.

#### T3.3: Challenge Griefing

**Threat**: An attacker repeatedly raises frivolous challenges to delay payment and harass workers.

**Mitigation**: Challengers must post their own stake. If the challenge is rejected, the challenger's stake is slashed. This makes frivolous challenges economically costly.

#### T3.4: Escrow Lockup

**Threat**: Funds remain locked indefinitely in escrow due to unresolved disputes.

**Mitigation**: Disputes have a defined lifecycle (open → arbitrating → resolved). Stakes have `expiresAt` timestamps. The `CancellationPolicy` defines grace periods. Implementation should enforce maximum dispute durations.

**Residual risk**: The protocol defines the mechanism but does not enforce time limits on arbitration at the schema level. Implementations must add timeout logic.

### 4. Privacy and Confidentiality

#### T4.1: Context Leakage

**Threat**: A worker extracts sensitive context data and uses it outside the task scope.

**Mitigations**:
- Context envelopes are encrypted (X25519 + AES-256-GCM) to the specific recipient.
- `onwardTransfer: false` signals that context should not be forwarded.
- `retentionPolicy.deleteOnCompletion` signals that context should be deleted after use.
- Redaction rules strip sensitive fields before sub-delegation.
- `revocationEndpoint` allows the sender to revoke access.

**Residual risk**: Once context is decrypted by the worker, the protocol cannot prevent a malicious worker from copying it. These controls are policy-level, not cryptographic enforcement. Trusted execution environments (TEEs) could provide stronger guarantees in future versions.

#### T4.2: Sub-Delegation Context Escalation

**Threat**: A sub-delegatee receives more context than intended.

**Mitigation**: Redaction rules (`remove`, `mask`, `hash`) are applied before forwarding context envelopes. UCAN attenuation ensures sub-delegates receive narrower capabilities. Each delegation can only narrow, never broaden, the scope of context access.

#### T4.3: Metadata Leakage

**Threat**: Even without reading encrypted payloads, an observer can learn about agent relationships, task patterns, and timing from message metadata.

**Residual risk**: Protocol messages expose `sender`, `recipient`, `timestamp`, and payload type in cleartext. Transport-level encryption (HTTPS) protects against passive network eavesdropping, but the registry and any intermediaries can observe interaction patterns.

### 5. Consensus and Reputation

#### T5.1: Sybil Attacks on Reputation

**Threat**: An attacker creates many fake identities, has them exchange tasks with each other, and builds artificial reputation.

**Mitigations**:
- Reputation is dual-signed — both requester and worker must sign receipts.
- Economic verification tiers require real stake, making Sybil operations expensive.
- Consensus verification excludes task parties from the validator pool.
- Trust tier filtering: requesters can require `same-owner` or `consortium` trust.

**Residual risk**: In the `open-internet` tier, Sybil attacks remain possible if the attacker is willing to stake funds across multiple identities. Rate limiting and stake requirements raise the cost but don't eliminate the risk.

#### T5.2: Validator Collusion

**Threat**: A subset of validators collude to approve bad results or reject good ones.

**Mitigations**:
- Random validator selection from the pool.
- Validators don't see each other's assessments until all have submitted.
- `excludeParties` prevents the requester and worker from being validators.
- `minReputation` filter ensures validators have track records.

**Residual risk**: If an attacker controls >= k validators in a k-of-n scheme, they can manipulate the outcome. Larger validator pools and higher thresholds reduce this risk.

#### T5.3: Reputation Grinding

**Threat**: An agent performs many trivial tasks to inflate their reputation, then uses it to win high-value tasks and cheat.

**Mitigation**: Domain-specific reputation scoring means trivial tasks in one domain don't inflate scores in another. Task complexity tracking helps distinguish easy from hard work.

**Residual risk**: Within a single domain, grinding remains possible. Weighted scoring (e.g., by task value or complexity) can mitigate but not eliminate this.

### 6. Capacity Sharing

#### T6.1: Capacity Fraud

**Threat**: An agent claims to have a Claude Max subscription (or other premium capacity source) but is actually running a free or lower-tier service. This inflates their perceived value and allows them to charge higher credit rates.

**Mitigations**:
- The `CapacitySource.verified` flag signals whether the subscription has been verified by the platform.
- Platforms can implement OAuth-based subscription verification with providers.
- Requesters can filter for `verified: true` capacity sources.
- Reputation scoring: agents with consistently poor quality relative to their declared provider will accumulate negative reputation.

**Residual risk**: Without provider-level OAuth integration, capacity claims are self-reported. A determined attacker can claim any provider/tier. Platforms should treat unverified capacity claims with appropriate skepticism.

#### T6.2: Free-Riding (Consuming Without Donating)

**Threat**: An agent consumes others' donated capacity (spending credits) without ever donating their own capacity back to the network.

**Mitigations**:
- The credit economy naturally limits free-riding: credits must come from somewhere (donation, work, or bootstrap grants).
- Bootstrap grants are finite — eventually the agent must earn credits by donating or working.
- Platform policies can require minimum donation ratios.
- The `CreditBalance.donated` field makes donation history transparent.

**Residual risk**: Agents who bootstrap large credit grants can consume capacity without donating for extended periods. This is a platform policy issue rather than a protocol-level threat.

### 7. Delegation

#### T7.1: Capability Escalation

**Threat**: A sub-delegate forges a UCAN token granting broader capabilities than were delegated.

**Mitigation**: UCAN tokens are signed by the issuer. The `delegateUCAN()` function enforces attenuation at creation time. `verifyDelegationChain()` checks every link in the chain for proper attenuation. Escalation requires forging the delegator's signature.

#### T7.2: Expired Delegation Use

**Threat**: An agent uses an expired UCAN token to access resources.

**Mitigation**: UCAN verification checks `exp` against current time. Context envelopes have independent `expires` timestamps. Both must be checked by the resource server.

## Trust Tier Summary

| Threat | same-owner | consortium | open-internet |
|--------|-----------|------------|---------------|
| Identity spoofing | Low (shared infra) | Low (known keys) | Mitigated (DID + signatures) |
| Fabricated results | Low (trusted) | Medium (verify) | Mitigated (Tier 2/3) |
| Free-riding (payment) | N/A (same entity) | Low (escrow) | Mitigated (escrow + dispute) |
| Context leakage | Low (same entity) | Medium (encryption) | Medium (encryption + policy) |
| Sybil attacks | N/A | Low (known members) | Medium (stake + reputation) |
| Validator collusion | N/A | Low (known validators) | Medium (random selection) |
| Capacity fraud | N/A (shared infra) | Low (known plans) | Medium (verification + reputation) |
| Free-riding (capacity) | N/A (same entity) | Low (pool policies) | Medium (donation tracking) |

## Recommendations for Implementers

1. **Always verify signatures** on received messages, receipts, and UCAN tokens.
2. **Track message IDs** to prevent replay attacks.
3. **Enforce stake requirements** proportional to task value for open-internet interactions.
4. **Use Tier 2 or 3** for high-value tasks with untrusted workers.
5. **Set context expiration** to the minimum viable duration.
6. **Implement dispute timeouts** to prevent indefinite escrow lockup.
7. **Use HTTPS** for all transport to protect against passive eavesdropping.
8. **Rotate keys** regularly and implement key compromise recovery procedures.
9. **Monitor for Sybil patterns** (many new identities, circular reputation building).
10. **Size validator pools** larger than the minimum to resist collusion.
