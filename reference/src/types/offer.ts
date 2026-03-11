import { z } from "zod";
import { DID, ISO8601, ULID, Duration, Price, Signature, EffortTier } from "./primitives.js";
import { CapacitySource } from "./exchange.js";

/** Context request — what the worker needs from the requester */
export const ContextRequest = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true),
});
export type ContextRequest = z.infer<typeof ContextRequest>;

/** Delegation request — permissions the worker needs */
export const DelegationRequest = z.object({
  capabilities: z.array(z.string()),
  maxDepth: z.number().int().nonnegative().default(0),
});
export type DelegationRequest = z.infer<typeof DelegationRequest>;

/** Verification plan — how the worker proposes to verify their output */
export const VerificationPlan = z.object({
  method: z.string(),
  description: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
});
export type VerificationPlan = z.infer<typeof VerificationPlan>;

/** Reputation claim — references to previous work */
export const ReputationClaim = z.object({
  receiptId: ULID,
  domain: z.string(),
  qualityScore: z.number().min(0).max(1).optional(),
});
export type ReputationClaim = z.infer<typeof ReputationClaim>;

/** Verifiable credential reference */
export const VerifiableCredential = z.object({
  type: z.string(),
  issuer: DID,
  credentialSubject: z.record(z.string(), z.unknown()),
  proof: z.string().optional(),
});
export type VerifiableCredential = z.infer<typeof VerifiableCredential>;

/** Offer (Bid) — a worker agent's response to a task */
export const Offer = z.object({
  id: ULID,
  taskId: ULID,
  worker: DID,
  created: ISO8601,
  expires: ISO8601,

  // Terms
  price: Price,
  estimatedDuration: Duration,
  confidence: z.number().min(0).max(1),

  // What worker needs
  requiredContext: z.array(ContextRequest).default([]),
  requiredDelegation: DelegationRequest.optional(),

  // How worker will verify
  proposedVerification: VerificationPlan.optional(),

  // Worker's evidence
  relevantReputation: z.array(ReputationClaim).default([]),
  relevantCredentials: z.array(VerifiableCredential).default([]),

  // Exchange layer
  proposedEffortTier: EffortTier.optional(),
  proposedCreditPrice: z.number().nonnegative().optional(),
  capacitySource: CapacitySource.optional(),

  signature: Signature,
});
export type Offer = z.infer<typeof Offer>;
