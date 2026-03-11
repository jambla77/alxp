import { z } from "zod";
import {
  DID,
  ISO8601,
  PublicKey,
  Signature,
  ServiceEndpoint,
  CostModel,
  AvailabilityInfo,
  TrustTier,
  EffortTier,
  Duration,
} from "./primitives.js";
import { EffortHistory, CapacitySource, CapacitySnapshot } from "./exchange.js";

/** Machine-parseable capability declaration */
export const CapabilityDescription = z.object({
  domain: z.string(),
  subDomain: z.string().optional(),
  confidenceLevel: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).optional(),
  constraints: z
    .object({
      maxInputTokens: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      maxDuration: Duration.optional(),
      requiredContext: z.array(z.string()).optional(),
    })
    .optional(),
  tags: z.array(z.string()),
});
export type CapabilityDescription = z.infer<typeof CapabilityDescription>;

/** Tool description (MCP-compatible) */
export const ToolDescription = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type ToolDescription = z.infer<typeof ToolDescription>;

/** Model information */
export const ModelInfo = z.object({
  provider: z.string().optional(),
  modelId: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** Agent Description — the "resume" of an agent */
export const AgentDescription = z.object({
  // Identity
  id: DID,
  publicKey: PublicKey,
  owner: DID.optional(),
  endpoints: z.array(ServiceEndpoint),

  // Capabilities
  capabilities: z.array(CapabilityDescription),
  tools: z.array(ToolDescription).default([]),
  modelInfo: ModelInfo.optional(),

  // Operational
  costModel: CostModel.optional(),
  availability: AvailabilityInfo,
  jurisdictions: z.array(z.string()).optional(),
  trustTier: TrustTier,

  // Exchange layer
  capabilityTier: EffortTier.optional(),
  effortHistory: z.array(EffortHistory).optional(),
  capacitySource: CapacitySource.optional(),
  capacitySnapshot: CapacitySnapshot.optional(),

  // Metadata
  created: ISO8601,
  updated: ISO8601,
  signature: Signature,
});
export type AgentDescription = z.infer<typeof AgentDescription>;
