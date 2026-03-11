# ALXP Identity and Authorization

**Version:** 0.1
**Status:** Draft

## Overview

ALXP uses self-certifying decentralized identifiers (DIDs) for agent identity, Ed25519 for cryptographic signing, X25519 for encryption key agreement, and UCAN tokens for delegable authorization. No central identity provider is required.

## Agent Identity

### DID Method: `did:key`

Every agent is identified by a `did:key` DID, which embeds the agent's Ed25519 public key directly in the identifier:

```
did:key:z<hex-encoded-ed25519-public-key>
```

This is **self-certifying**: the DID itself proves the agent controls the corresponding private key. No external registry is needed to verify the binding between identifier and key.

### Key Pair Generation

```
Algorithm: Ed25519
Library:   @noble/ed25519 v3 + @noble/hashes (sha512)
Key size:  32 bytes (private), 32 bytes (public)
```

The reference implementation uses `ed25519.utils.randomSecretKey()` for private key generation and `ed25519.getPublicKey()` to derive the public key.

### DID Document

Each agent has a DID Document following the W3C DID Core specification:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:key:z<pubHex>",
  "verificationMethod": [{
    "id": "did:key:z<pubHex>#key-1",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:key:z<pubHex>",
    "publicKeyHex": "<pubHex>"
  }],
  "authentication": ["did:key:z<pubHex>#key-1"],
  "assertionMethod": ["did:key:z<pubHex>#key-1"],
  "service": [{
    "id": "did:key:z<pubHex>#alxp",
    "type": "ALXPEndpoint",
    "serviceEndpoint": "https://agent.example.com/alxp"
  }]
}
```

### DID Resolution

For `did:key` DIDs, resolution is local — the public key is extracted directly from the DID string. A `DIDResolver` class provides in-memory resolution for testing with other DID methods.

```
did:key:z<hex> → extract hex after "did:key:z" prefix → Ed25519 public key
```

## Cryptographic Signing

### Message Signing

All protocol messages are signed using the sender's Ed25519 private key:

1. Build message object (without signature).
2. Canonicalize to deterministic JSON (RFC 8785 / JCS).
3. Encode canonical string as UTF-8 bytes.
4. Sign with Ed25519 private key.
5. Encode signature as hex string.

### Signature Verification

1. Extract sender DID from message.
2. Derive public key from `did:key` DID.
3. Reconstruct canonical form of unsigned message.
4. Verify Ed25519 signature.

### What Gets Signed

| Object | Signed Content |
|--------|---------------|
| `ProtocolMessage` | Canonicalized message (excluding `signature` field) |
| `AgentDescription` | `"${did}:${timestamp}"` |
| `ContextEnvelope` | `"${envelopeId}:${contractId}"` |
| `UCANToken` | Canonicalized token (excluding `sig` field) |
| `DisputeEvidence` | `"${description}:${timestamp}"` |
| `DisputeResolution` | `"${outcome}:${refundPercent}:${timestamp}"` |

## Encryption

### Key Agreement: X25519

For encrypted context transfer, ALXP converts Ed25519 keys to X25519 (Curve25519) keys using the birational map between the Edwards and Montgomery forms:

```
Ed25519 public key  → X25519 public key   (toMontgomery)
Ed25519 private key → X25519 private key  (toMontgomerySecret)
```

This allows agents to reuse their identity key pair for both signing and encryption without separate key management.

### Encryption: X25519 + AES-256-GCM

Context payloads are encrypted using:

1. **Key agreement**: X25519 ECDH between sender's ephemeral key and recipient's X25519 public key.
2. **Key derivation**: HKDF-SHA256 to derive a 256-bit AES key from the shared secret.
3. **Encryption**: AES-256-GCM with a random 12-byte nonce.

Each payload in a `ContextEnvelope` is encrypted individually, enabling selective decryption and redaction.

### Encrypted Payload Format

```json
{
  "ciphertext": "<base64>",
  "nonce": "<hex>",
  "ephemeralPublicKey": "<hex>",
  "tag": "<hex>"
}
```

## Authorization: UCAN

### Overview

UCAN (User Controlled Authorization Networks) tokens are the authorization primitive for ALXP. They are:

- **Delegable**: Agent A can grant capabilities to Agent B, who can further delegate to Agent C.
- **Attenuable**: Each delegation can only narrow permissions, never escalate.
- **Self-contained**: Verification requires only the token chain and public keys — no authorization server.
- **Time-limited**: Every token has an expiration.

### Token Structure

```json
{
  "ucv": "0.10.0",
  "id": "<ULID>",
  "iss": "<DID>",
  "aud": "<DID>",
  "att": [
    { "with": "alxp://context/contract-01HXYZ", "can": "context/read" }
  ],
  "exp": 1735689600,
  "nbf": 1735603200,
  "nnc": "<ULID>",
  "prf": ["<parent-token-id>"],
  "fct": {},
  "sig": "<hex>"
}
```

### Fields

| Field | Description |
|-------|-------------|
| `ucv` | UCAN spec version (`"0.10.0"`) |
| `id` | Unique token identifier (ULID) |
| `iss` | Issuer DID — who grants the capability |
| `aud` | Audience DID — who receives the capability |
| `att` | Array of capabilities (`{ with, can }`) |
| `exp` | Expiration (Unix timestamp, seconds) |
| `nbf` | Not-before time (optional) |
| `nnc` | Nonce for replay protection |
| `prf` | Proof chain — IDs of parent tokens |
| `fct` | Additional facts/claims (optional) |
| `sig` | Issuer's Ed25519 signature over canonicalized token |

### Well-Known Capabilities

| Action | Description |
|--------|-------------|
| `context/read` | Read context associated with a task |
| `context/write` | Provide context data |
| `task/submit` | Submit results for a task |
| `task/delegate` | Delegate task to another agent |
| `task/verify` | Verify/review submitted work |
| `*` | Wildcard — all actions on a resource |

### Resource URIs

Capabilities are scoped to resources using URI patterns:

```
alxp://context/contract-01HXYZ           Specific contract context
alxp://context/*                         All context (wildcard)
alxp://task/01HXYZ                       Specific task
```

### Delegation Chain

When Agent A delegates to Agent B, and B further delegates to C:

```
Token 1: A → B  (capabilities: [context/read, task/submit], prf: [])
Token 2: B → C  (capabilities: [context/read],             prf: [token-1-id])
```

**Attenuation rules:**
- The child token's `iss` must equal the parent token's `aud`.
- The child's capabilities must be a subset of the parent's.
- The child's expiration must not exceed the parent's.
- Resource scoping: `alxp://context/*` covers `alxp://context/contract-01`.
- Action scoping: `*` covers all actions; `context/*` covers `context/read`.

### Verification

Single token verification checks:
1. Signature validity (issuer's Ed25519 key).
2. Token not expired (`exp > now`).
3. Not-before time passed (`nbf <= now`, if set).

Delegation chain verification additionally checks:
4. Each link's `iss` equals the parent's `aud`.
5. Each link's capabilities are a subset of the parent's.
6. Every token in the chain passes individual verification.

An `AttenuationError` is thrown if any delegation attempts to escalate capabilities beyond what was granted by the parent.

### Token Store

The `UCANTokenStore` provides in-memory storage for resolving proof chains:

- `store(token)` — persist a token by ID.
- `get(id)` — retrieve by ULID.
- `issuedBy(did)` — all tokens issued by a DID.
- `grantedTo(did)` — all tokens granted to a DID.

## Context Envelopes

Context envelopes combine encryption, scoping, and access control:

| Property | Purpose |
|----------|---------|
| `contractId` | Scopes context to a specific contract |
| `encryption` | X25519 + AES-256-GCM parameters |
| `expires` | Time-limited access |
| `retentionPolicy` | When to delete (`deleteOnCompletion`) |
| `onwardTransfer` | Whether the recipient may forward context |
| `redactionRules` | Fields to remove/mask/hash before sub-delegation |
| `revocationEndpoint` | URL to check if context has been revoked |

### Redaction for Sub-Delegation

When a worker delegates a subtask, they can redact the context envelope before forwarding:

- **`remove`**: Strip the entire payload.
- **`mask`**: Replace sensitive fields with masked values.
- **`hash`**: Replace values with their SHA-256 hashes (proves existence without revealing content).

This enforces the principle that sub-delegation can only attenuate context — a sub-worker never receives more context than their delegator.
