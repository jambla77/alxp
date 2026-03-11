import { z } from "zod";
import { DID, ISO8601, ULID, DisputeReason, Signature } from "./primitives.js";

/** Dispute evidence */
export const DisputeEvidence = z.object({
  submitter: DID,
  description: z.string(),
  data: z.string().optional(),
  timestamp: ISO8601,
  signature: Signature,
});
export type DisputeEvidence = z.infer<typeof DisputeEvidence>;

/** Dispute resolution */
export const DisputeResolution = z.object({
  outcome: z.enum(["requester-wins", "worker-wins", "compromise"]),
  description: z.string(),
  refundPercent: z.number().min(0).max(100).optional(),
  timestamp: ISO8601,
});
export type DisputeResolution = z.infer<typeof DisputeResolution>;

/** Dispute Record — when things go wrong */
export const DisputeRecord = z.object({
  id: ULID,
  contractId: ULID,
  initiator: DID,
  respondent: DID,

  // What happened
  reason: DisputeReason,
  evidence: z.array(DisputeEvidence),

  // Resolution
  status: z.enum(["open", "arbitrating", "resolved"]),
  arbitrator: DID.optional(),
  resolution: DisputeResolution.optional(),

  created: ISO8601,
  resolved: ISO8601.optional(),

  signatures: z.array(Signature),
});
export type DisputeRecord = z.infer<typeof DisputeRecord>;
