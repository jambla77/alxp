# ALXP Message Protocol

**Version:** 0.1
**Status:** Draft

## Overview

All agent-to-agent communication in ALXP uses signed `ProtocolMessage` envelopes. Messages are serialized as JSON, canonicalized per RFC 8785 (JSON Canonicalization Scheme) for signing, and transported over JSON-RPC 2.0.

## Wire Format

```json
{
  "version": "alxp/0.1",
  "id": "<ULID>",
  "timestamp": "<ISO8601>",
  "sender": "<DID>",
  "recipient": "<DID>",
  "replyTo": "<ULID>",
  "payload": { "type": "<message-type>", ... },
  "headers": { "<key>": "<value>" },
  "signature": "<hex-encoded Ed25519 signature>"
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Protocol version. Always `"alxp/0.1"`. |
| `id` | Yes | Unique message identifier (ULID). |
| `timestamp` | Yes | ISO 8601 creation time. |
| `sender` | Yes | DID of the sending agent. |
| `recipient` | No | DID of the intended receiver. |
| `replyTo` | No | Message ID this is responding to. |
| `payload` | Yes | Discriminated union on `type` (see below). |
| `headers` | No | Arbitrary key-value metadata. |
| `signature` | Yes | Ed25519 signature over canonicalized message. |

## Message Types

The `payload` field is a discriminated union on the `type` key. Eight message types are defined:

### 1. `ANNOUNCE_TASK`

Requester publishes a task for bidding.

```json
{ "type": "ANNOUNCE_TASK", "taskSpec": <TaskSpec> }
```

**Triggers**: `POSTED` state. Sent to registry or directly to known workers.

### 2. `BID`

Worker submits an offer for a task.

```json
{ "type": "BID", "offer": <Offer> }
```

**Triggers**: `POSTED → BIDDING` (on first offer).

### 3. `AWARD`

Requester accepts an offer and forms a contract.

```json
{
  "type": "AWARD",
  "contract": <TaskContract>,
  "contextEnvelope": <ContextEnvelope>   // optional
}
```

**Triggers**: `BIDDING → AWARDED`. The contract contains dual signatures. Context may be delivered inline or separately.

### 4. `SUBMIT_RESULT`

Worker delivers completed work.

```json
{ "type": "SUBMIT_RESULT", "result": <ResultBundle> }
```

**Triggers**: `RUNNING → SUBMITTED`.

### 5. `VERIFY`

Requester communicates the verification verdict.

```json
{
  "type": "VERIFY",
  "contractId": "<ULID>",
  "verdict": "accepted" | "rejected" | "disputed",
  "receipt": <WorkReceipt>,          // if accepted
  "disputeRecord": <DisputeRecord>,  // if disputed
  "feedback": "<string>"             // optional
}
```

**Triggers**: `REVIEWING → ACCEPTED | REJECTED | DISPUTED`.

### 6. `SETTLE`

Final settlement acknowledgment with optional proof.

```json
{
  "type": "SETTLE",
  "contractId": "<ULID>",
  "receipt": <WorkReceipt>,
  "settlementProof": { "type": "<string>", "ref": "<string>", "timestamp": "<ISO8601>" }
}
```

**Triggers**: `ACCEPTED → SETTLED`.

### 7. `CHALLENGE_RESULT` (Tier 2)

A party challenges an optimistically-accepted result.

```json
{ "type": "CHALLENGE_RESULT", "challenge": <Challenge> }
```

**Triggers**: `PENDING_CHALLENGE → DISPUTED`. The challenger must post stake.

### 8. `VALIDATOR_ASSESS` (Tier 3)

An independent validator submits their assessment.

```json
{ "type": "VALIDATOR_ASSESS", "assessment": <ValidatorAssessment> }
```

**Triggers**: Used during `VALIDATING` state. The `ConsensusVerifier` aggregates assessments and triggers `consensus_passed` or `consensus_failed`.

## Signing and Verification

### Signing Process

1. Build the message object with all fields populated (signature set to empty or omitted).
2. Remove the `signature` field.
3. Canonicalize the remaining object per RFC 8785 (JCS):
   - Object keys sorted lexicographically
   - No whitespace
   - `undefined` values omitted
   - Arrays preserve order
4. Sign the canonical UTF-8 string with the sender's Ed25519 private key.
5. Encode the signature as hex and set the `signature` field.

### Verification Process

1. Extract the `signature` field from the message.
2. Reconstruct the unsigned message (signature removed/set to undefined).
3. Canonicalize using the same JCS rules.
4. Resolve the sender's public key from their DID (for `did:key`, extract directly from the DID string).
5. Verify the Ed25519 signature against the canonical bytes.

### Canonicalization (RFC 8785)

The `canonicalize()` function implements deterministic JSON serialization:

- `null` → `"null"`
- Booleans and numbers → `JSON.stringify`
- Strings → JSON-escaped
- Arrays → `[item1,item2,...]` (no spaces, order preserved)
- Objects → `{"key1":value1,"key2":value2,...}` (keys sorted, no spaces, `undefined` omitted)

This ensures that the same logical object always produces the same byte sequence for signing, regardless of property insertion order or formatting.

## Transport Binding: JSON-RPC 2.0

ALXP messages are transported as JSON-RPC 2.0 requests over HTTPS.

### Endpoint

```
POST /alxp
Content-Type: application/json
```

### Method Mapping

| Payload Type | JSON-RPC Method |
|-------------|----------------|
| `ANNOUNCE_TASK` | `alxp.announceTask` |
| `BID` | `alxp.bid` |
| `AWARD` | `alxp.award` |
| `SUBMIT_RESULT` | `alxp.submitResult` |
| `VERIFY` | `alxp.verify` |
| `SETTLE` | `alxp.settle` |
| `CHALLENGE_RESULT` | `alxp.challengeResult` |
| `VALIDATOR_ASSESS` | `alxp.validatorAssess` |

### Request Format

```json
{
  "jsonrpc": "2.0",
  "method": "alxp.announceTask",
  "params": { <ProtocolMessage> },
  "id": 1
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "result": { "status": "accepted", "messageId": "<ULID>" },
  "id": 1
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error — invalid JSON |
| `-32600` | Invalid request — not a valid JSON-RPC object |
| `-32601` | Method not found |
| `-32602` | Invalid params — message validation failed |
| `-32003` | Signature verification failed |
| `-32000` | Handler error — application-level failure |

### Server Validation Pipeline

1. Parse JSON body as JSON-RPC request.
2. Validate the `params` field as a `ProtocolMessage` (Zod schema).
3. Verify the message signature.
4. Confirm the payload type matches the JSON-RPC method.
5. Route to the registered message handler.

## Message Routing

The `MessageRouter` dispatches messages to registered handlers by payload type:

```typescript
const router = new MessageRouter();
router.on("ANNOUNCE_TASK", async (message) => { ... });
router.on("BID", async (message) => { ... });
```

`router.hasHandler(type)` checks whether a handler is registered for a given type.

## Async Notifications

For long-running tasks, ALXP supports webhook callbacks and SSE progress streams:

- **WebhookPublisher**: Registers callback URLs per contract and sends `POST` notifications for state changes, progress updates, heartbeats, and errors.
- **WebhookReceiver**: Hono HTTP server that receives webhook `POST` requests and routes them to handlers.
- **ProgressStream**: In-memory event bus for SSE-style real-time updates. Supports `progress`, `heartbeat`, `complete`, and `error` events with subscribe/unsubscribe.
