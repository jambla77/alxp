import { z } from "zod";
import { DID, ISO8601, ULID, Price, Signature } from "./primitives.js";

/** Stake — economic bond put up by a worker */
export const Stake = z.object({
  id: ULID,
  contractId: ULID,
  staker: DID,
  amount: Price,
  status: z.enum(["locked", "released", "slashed", "refunded"]),
  lockedAt: ISO8601,
  expiresAt: ISO8601,
  signature: Signature,
});
export type Stake = z.infer<typeof Stake>;

/** Challenge — dispute of an optimistically accepted result */
export const Challenge = z.object({
  id: ULID,
  contractId: ULID,
  resultId: ULID,
  challenger: DID,
  reason: z.string(),
  evidence: z.array(z.object({
    description: z.string(),
    data: z.string().optional(),
  })),
  challengerStake: Price,
  created: ISO8601,
  windowExpires: ISO8601,
  status: z.enum(["open", "reviewing", "upheld", "rejected"]),
  resolution: z.object({
    outcome: z.enum(["challenger-wins", "worker-wins"]),
    reason: z.string(),
    resolvedAt: ISO8601,
  }).optional(),
  signature: Signature,
});
export type Challenge = z.infer<typeof Challenge>;

/** Spot check configuration — random auditing of accepted results */
export const SpotCheckConfig = z.object({
  probability: z.number().min(0).max(1),
  method: z.enum(["automated-rerun", "consensus", "human"]),
  slashMultiplier: z.number().min(1).default(5),
});
export type SpotCheckConfig = z.infer<typeof SpotCheckConfig>;
