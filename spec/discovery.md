# ALXP Agent Discovery

**Version:** 0.1
**Status:** Draft

## Overview

Discovery in ALXP allows requesters to find workers capable of performing tasks. Agents advertise their capabilities through signed Agent Cards (AgentDescription objects), which are published to registries and matched against capability queries.

## Agent Cards

An Agent Card is a signed `AgentDescription` object — the agent's "resume". It contains everything a requester needs to evaluate whether an agent is suitable for a task.

### Card Contents

| Section | Fields |
|---------|--------|
| **Identity** | `id` (DID), `publicKey`, `owner`, `name`, `description` |
| **Endpoints** | `endpoints[]` — URL + transport (`https` or `wss`) |
| **Capabilities** | `capabilities[]` — domain, subdomain, confidence, tags |
| **Tools** | `tools[]` — MCP-compatible tool declarations |
| **Model** | `modelInfo` — provider, modelId, context window |
| **Pricing** | `costModel` — base price, per-token rates, currency |
| **Availability** | `availability` — status, capacity, average latency |
| **Trust** | `trustTier` — `same-owner`, `consortium`, or `open-internet` |
| **Jurisdictions** | `jurisdictions[]` — operating regions |
| **Metadata** | `created`, `updated`, `signature` |

### Capability Description

Each capability entry describes a domain of expertise:

```json
{
  "domain": "code-generation",
  "subDomain": "typescript",
  "confidenceLevel": 0.92,
  "evidenceRefs": ["receipt-01HXYZ"],
  "constraints": {
    "maxInputTokens": 100000,
    "maxOutputTokens": 4096,
    "maxDuration": "PT10M",
    "requiredContext": ["codebase"]
  },
  "tags": ["typescript", "node", "react"]
}
```

### Card Signing

Agent Cards are signed with the agent's Ed25519 private key over the string `"${did}:${timestamp}"`. This proves the card was created by the agent it claims to represent.

### Card Generation

```typescript
const card = generateAgentCard({
  identity,               // AgentIdentity (did + keyPair + document)
  name: "Code Worker",
  description: "TypeScript code generation specialist",
  capabilities: [...],
  trustTier: "open-internet",
  endpoint: "https://worker.example.com/alxp",
  costModel: { currency: "USD", perTokenOutput: 0.001 },
});
```

## Capability Matching

Requesters search for agents using `CapabilityQuery` objects. A query specifies the desired capability and constraints.

### Query Fields

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Required. The capability domain (e.g., `"code-generation"`). |
| `subDomain` | string | Optional. Narrows to a specific subdomain (e.g., `"typescript"`). |
| `minConfidence` | number (0–1) | Minimum confidence level. |
| `maxPrice` | number | Maximum acceptable price. |
| `priceCurrency` | string | Currency for price comparison. |
| `requiredTrustTier` | TrustTier | Minimum trust tier. |
| `tags` | string[] | All listed tags must be present. |

### Matching Algorithm

An agent matches a query if ALL of the following hold:

1. **Domain match**: At least one capability has the queried domain.
2. **Subdomain match** (if specified): The matching capability has the queried subdomain.
3. **Confidence threshold**: The capability's `confidenceLevel >= minConfidence`.
4. **Tag inclusion**: All query tags are present in the capability's tags.
5. **Trust tier rank**: The agent's trust tier ranks at or above the required tier.
   - Rank order: `same-owner` (highest) > `consortium` > `open-internet` (lowest).
6. **Price limit**: If the agent has a `costModel.basePrice`, it must be `<= maxPrice` in the same currency.

## Agent Registry

The `AgentRegistry` provides in-memory storage and querying of Agent Cards.

### Operations

| Operation | Description |
|-----------|-------------|
| `register(card)` | Store an Agent Card, keyed by DID |
| `unregister(did)` | Remove an agent from the registry |
| `get(did)` | Retrieve a single agent's card |
| `query(query)` | Find all agents matching a `CapabilityQuery` |
| `list()` | Return all registered agents |
| `verifyCard(card)` | Verify the agent's signature on the card |

### Signature Verification

Before accepting a card, the registry verifies the signature:

1. Extract the agent's public key from their DID.
2. Reconstruct the signed string: `"${card.id}:${card.created}"`.
3. Verify the Ed25519 signature.

Cards with invalid signatures are rejected with a `401` response.

## Registry HTTP API

The `RegistryServer` exposes the registry over HTTP using Hono.

### Endpoints

#### `GET /.well-known/agent.json`

List all registered agents.

**Response:**
```json
{
  "agents": [ <AgentDescription>, ... ],
  "count": 42
}
```

#### `GET /agents/:did`

Retrieve a specific agent's card.

**Response:** `200` with `AgentDescription`, or `404` if not found.

#### `POST /agents`

Register a new agent. The request body is an `AgentDescription`.

**Validation:**
1. Verify the card's Ed25519 signature.
2. Store the card in the registry.

**Response:** `201` with `{ registered: true, did }`, or `401` if signature verification fails.

#### `POST /agents/query`

Search for agents by capability. The request body is a `CapabilityQuery`.

**Response:**
```json
{
  "agents": [ <AgentDescription>, ... ],
  "count": 5
}
```

#### `DELETE /agents/:did`

Remove an agent from the registry.

**Response:** `200` with `{ unregistered: true, did }`, or `404` if not found.

### Well-Known URI

The `/.well-known/agent.json` endpoint follows the well-known URI convention, making it discoverable via standard mechanisms. A requester can probe any domain's well-known endpoint to discover agents hosted there.

## Trust Tiers

Trust tiers indicate the relationship between agents and influence verification requirements:

| Tier | Description | Typical Verification |
|------|-------------|---------------------|
| `same-owner` | Agents owned by the same entity | Automated (Tier 1) |
| `consortium` | Agents in a known federation | Automated or optimistic |
| `open-internet` | Unknown agents, no prior relationship | Economic or consensus |

Higher trust tiers may warrant lighter verification, while open-internet interactions typically require economic stake or multi-validator consensus.
