/**
 * Agent Card — the discoverable profile of an ALXP agent.
 *
 * Agent Cards are published at well-known endpoints and registered
 * with discovery services. They extend the A2A Agent Card concept
 * with ALXP-specific fields: cost model, trust tier, reputation refs.
 *
 * Discovery modes:
 * - Mode A: Registry — agents publish cards to known registries
 * - Mode B: Well-known endpoint — GET /.well-known/agent.json
 */

import { signString, publicKeyToHex } from "../identity/signing.js";
import type { AgentIdentity } from "../identity/did.js";
import type {
  AgentDescription as AgentDescriptionType,
  CapabilityDescription as CapabilityDescriptionType,
  TrustTier,
  CostModel as CostModelType,
} from "../types/index.js";

/** Options for generating an Agent Card */
export interface AgentCardOptions {
  identity: AgentIdentity;
  name?: string;
  description?: string;
  capabilities: CapabilityDescriptionType[];
  trustTier: TrustTier;
  endpoint: string;
  costModel?: CostModelType;
  jurisdictions?: string[];
  modelInfo?: {
    provider?: string;
    modelId?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  };
}

/**
 * Generate a signed Agent Card (AgentDescription) from identity and options.
 */
export function generateAgentCard(options: AgentCardOptions): AgentDescriptionType {
  const {
    identity,
    capabilities,
    trustTier,
    endpoint,
    costModel,
    jurisdictions,
    modelInfo,
  } = options;

  const now = new Date().toISOString();
  const pubHex = publicKeyToHex(identity.keyPair.publicKey);

  const card: AgentDescriptionType = {
    id: identity.did,
    publicKey: pubHex,
    endpoints: [{ url: endpoint, transport: "https" }],
    capabilities,
    tools: [],
    modelInfo,
    costModel,
    availability: { status: "online" },
    jurisdictions,
    trustTier,
    created: now,
    updated: now,
    signature: signString(`${identity.did}:${now}`, identity.keyPair.privateKey),
  };

  return card;
}

/** Capability query for matching agents */
export interface CapabilityQuery {
  domain: string;
  subDomain?: string;
  minConfidence?: number;
  maxPrice?: number;
  priceCurrency?: string;
  requiredTrustTier?: TrustTier;
  tags?: string[];
}

/**
 * Check if an agent card matches a capability query.
 */
export function matchesQuery(
  card: AgentDescriptionType,
  query: CapabilityQuery,
): boolean {
  // Must have at least one matching capability
  const matchingCap = card.capabilities.find((cap) => {
    // Domain must match
    if (cap.domain !== query.domain) return false;

    // SubDomain must match if specified
    if (query.subDomain && cap.subDomain !== query.subDomain) return false;

    // Confidence must meet minimum
    if (query.minConfidence !== undefined) {
      if ((cap.confidenceLevel ?? 0) < query.minConfidence) return false;
    }

    // Tags must match if specified (all query tags must be present)
    if (query.tags && query.tags.length > 0) {
      if (!query.tags.every((t) => cap.tags.includes(t))) return false;
    }

    return true;
  });

  if (!matchingCap) return false;

  // Trust tier must meet or exceed requirement
  if (query.requiredTrustTier) {
    const tierRank: Record<TrustTier, number> = {
      "open-internet": 0,
      consortium: 1,
      "same-owner": 2,
    };
    if (tierRank[card.trustTier] < tierRank[query.requiredTrustTier]) return false;
  }

  // Price must be within budget
  if (query.maxPrice !== undefined && card.costModel?.basePrice) {
    const currency = query.priceCurrency ?? "USD";
    if (card.costModel.basePrice.currency === currency) {
      if (card.costModel.basePrice.amount > query.maxPrice) return false;
    }
  }

  return true;
}
