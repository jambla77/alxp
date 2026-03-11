import { z } from "zod";
import { DID, ISO8601, ULID, Price, Signature, CancellationPolicy } from "./primitives.js";
import { VerificationPlan } from "./offer.js";
import { Stake } from "./staking.js";

/** Delegation grant (simplified UCAN token reference) */
export const DelegationGrant = z.object({
  issuer: DID,
  audience: DID,
  capabilities: z.array(z.string()),
  expiration: ISO8601,
  token: z.string(),
});
export type DelegationGrant = z.infer<typeof DelegationGrant>;

/** Escrow reference */
export const EscrowReference = z.object({
  type: z.string(),
  ref: z.string(),
});
export type EscrowReference = z.infer<typeof EscrowReference>;

/** Task Contract — signed agreement between requester and worker */
export const TaskContract = z.object({
  id: ULID,
  taskId: ULID,
  offerId: ULID,
  requester: DID,
  worker: DID,

  // Agreed terms
  agreedPrice: Price,
  agreedDeadline: ISO8601,
  agreedVerification: VerificationPlan,
  delegationGrant: DelegationGrant,

  // Escrow/settlement
  escrowRef: EscrowReference.optional(),

  // Staking (Tier 2 economic verification)
  workerStake: Stake.optional(),

  // Cancellation terms
  cancellationPolicy: CancellationPolicy,

  // Signatures from BOTH parties
  requesterSignature: Signature,
  workerSignature: Signature,

  formed: ISO8601,
});
export type TaskContract = z.infer<typeof TaskContract>;
