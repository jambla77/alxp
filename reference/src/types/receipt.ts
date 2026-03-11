import { z } from "zod";
import { DID, ISO8601, ULID, Price, Signature } from "./primitives.js";

/** Settlement reference */
export const SettlementReference = z.object({
  type: z.string(),
  ref: z.string(),
  timestamp: ISO8601,
});
export type SettlementReference = z.infer<typeof SettlementReference>;

/** Work Receipt — issued after verification, building block of reputation */
export const WorkReceipt = z.object({
  id: ULID,
  contractId: ULID,
  taskId: ULID,
  requester: DID,
  worker: DID,

  // Outcome
  status: z.enum(["accepted", "rejected", "disputed", "partial"]),
  acceptedAt: ISO8601.optional(),

  // Performance data (for reputation)
  qualityScore: z.number().min(0).max(1).optional(),
  timelinessScore: z.number().min(0).max(1).optional(),
  taskDomain: z.string(),
  taskComplexity: z.number().min(0).max(1).optional(),

  // Settlement
  amountSettled: Price.optional(),
  settlementRef: SettlementReference.optional(),

  // Verification metadata
  provenanceRootHash: z.string().optional(),
  verificationTier: z.enum(["automated", "economic", "consensus", "human"]).optional(),

  // Both parties sign to prevent fabrication
  requesterSignature: Signature,
  workerSignature: Signature,
});
export type WorkReceipt = z.infer<typeof WorkReceipt>;
