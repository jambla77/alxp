import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";

/** A single validator's assessment */
export const ValidatorAssessment = z.object({
  validator: DID,
  contractId: ULID,
  resultId: ULID,
  accepted: z.boolean(),
  qualityScore: z.number().min(0).max(1),
  reasoning: z.string(),
  assessedAt: ISO8601,
  signature: Signature,
});
export type ValidatorAssessment = z.infer<typeof ValidatorAssessment>;

/** Consensus verification result */
export const ConsensusResult = z.object({
  id: ULID,
  contractId: ULID,
  resultId: ULID,
  validators: z.array(DID),
  assessments: z.array(ValidatorAssessment),
  threshold: z.number().min(0).max(1),
  acceptanceRatio: z.number().min(0).max(1),
  averageQuality: z.number().min(0).max(1),
  passed: z.boolean(),
  completedAt: ISO8601,
});
export type ConsensusResult = z.infer<typeof ConsensusResult>;
