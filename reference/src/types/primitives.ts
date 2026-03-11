import { z } from "zod";

// ── Primitive types used across all objects ──

/** Decentralized Identifier (W3C DID) */
export const DID = z.string().regex(/^did:[a-z]+:.+$/, "Must be a valid DID");
export type DID = z.infer<typeof DID>;

/** ISO 8601 timestamp */
export const ISO8601 = z.string().datetime();
export type ISO8601 = z.infer<typeof ISO8601>;

/** ULID identifier */
export const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Must be a valid ULID");
export type ULID = z.infer<typeof ULID>;

/** Duration in ISO 8601 format (e.g., PT1H30M) */
export const Duration = z.string().regex(/^P/, "Must be an ISO 8601 duration");
export type Duration = z.infer<typeof Duration>;

/** Ed25519 public key (base64url encoded) */
export const PublicKey = z.string().min(1);
export type PublicKey = z.infer<typeof PublicKey>;

/** Cryptographic signature (base64url encoded) */
export const Signature = z.string().min(1);
export type Signature = z.infer<typeof Signature>;

/** URL string */
export const URL_ = z.string().url();
export type URL_ = z.infer<typeof URL_>;

/** Trust tiers */
export const TrustTier = z.enum(["same-owner", "consortium", "open-internet"]);
export type TrustTier = z.infer<typeof TrustTier>;

/** Privacy classification */
export const PrivacyClass = z.enum(["public", "confidential", "restricted"]);
export type PrivacyClass = z.infer<typeof PrivacyClass>;

/** Task priority */
export const Priority = z.enum(["low", "normal", "high", "critical"]);
export type Priority = z.infer<typeof Priority>;

/** Task state */
export const TaskState = z.enum([
  "POSTED",
  "BIDDING",
  "AWARDED",
  "RUNNING",
  "CHECKPOINT",
  "BLOCKED",
  "SUBMITTED",
  "REVIEWING",
  "PENDING_CHALLENGE",
  "VALIDATING",
  "ACCEPTED",
  "REJECTED",
  "DISPUTED",
  "SETTLED",
  "ARBITRATING",
  "RESOLVED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
]);
export type TaskState = z.infer<typeof TaskState>;

/** Verification method */
export const VerificationMethod = z.enum(["optimistic", "consensus", "proof", "automated"]);
export type VerificationMethod = z.infer<typeof VerificationMethod>;

/** Dispute reason */
export const DisputeReason = z.enum([
  "quality-insufficient",
  "deadline-missed",
  "scope-mismatch",
  "non-payment",
  "context-misuse",
  "other",
]);
export type DisputeReason = z.infer<typeof DisputeReason>;

/** Price model */
export const Price = z.object({
  amount: z.number().nonnegative(),
  currency: z.string(),
  model: z.enum(["fixed", "per-token", "per-hour", "milestone"]),
});
export type Price = z.infer<typeof Price>;

/** Budget (max willing to pay) */
export const Budget = z.object({
  maxAmount: z.number().nonnegative(),
  currency: z.string(),
});
export type Budget = z.infer<typeof Budget>;

/** Cost model for agent pricing */
export const CostModel = z.object({
  basePrice: Price.optional(),
  perTokenInput: z.number().nonnegative().optional(),
  perTokenOutput: z.number().nonnegative().optional(),
  currency: z.string(),
});
export type CostModel = z.infer<typeof CostModel>;

/** Service endpoint */
export const ServiceEndpoint = z.object({
  url: URL_,
  transport: z.enum(["https", "wss"]).default("https"),
});
export type ServiceEndpoint = z.infer<typeof ServiceEndpoint>;

/** Availability information */
export const AvailabilityInfo = z.object({
  status: z.enum(["online", "busy", "offline"]),
  capacity: z.number().int().nonnegative().optional(),
  avgLatencyMs: z.number().nonnegative().optional(),
});
export type AvailabilityInfo = z.infer<typeof AvailabilityInfo>;

/** Delegation policy */
export const DelegationPolicy = z.object({
  allowSubDelegation: z.boolean(),
  maxDepth: z.number().int().nonnegative().default(0),
  requireApproval: z.boolean().default(true),
});
export type DelegationPolicy = z.infer<typeof DelegationPolicy>;

/** Retention policy for context */
export const RetentionPolicy = z.object({
  maxDuration: Duration.optional(),
  deleteOnCompletion: z.boolean().default(true),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

/** Cancellation policy */
export const CancellationPolicy = z.object({
  allowedBy: z.enum(["requester", "worker", "both"]),
  penaltyPercent: z.number().min(0).max(100).default(0),
  gracePeriod: Duration.optional(),
});
export type CancellationPolicy = z.infer<typeof CancellationPolicy>;

/** Encryption info */
export const EncryptionInfo = z.object({
  algorithm: z.string(),
  recipientPublicKey: PublicKey,
  ephemeralPublicKey: PublicKey.optional(),
  nonce: z.string().optional(),
});
export type EncryptionInfo = z.infer<typeof EncryptionInfo>;

/** Acceptance criteria (discriminated union) */
export const AcceptanceCriteria = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schema"),
    schema: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("test"),
    testSuite: z.string(),
  }),
  z.object({
    type: z.literal("hash"),
    expectedHash: z.string(),
  }),
  z.object({
    type: z.literal("rubric"),
    rubric: z.string(),
    minScore: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("consensus"),
    validators: z.number().int().positive(),
    threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("human"),
    reviewer: DID,
  }),
  z.object({
    type: z.literal("optimistic"),
    challengeWindow: Duration,
  }),
]);
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>;

/** Async configuration for long-running tasks */
export const AsyncConfig = z.object({
  callbackUrl: URL_,
  heartbeatInterval: Duration.optional(),
  streamingSupported: z.boolean().default(false),
});
export type AsyncConfig = z.infer<typeof AsyncConfig>;
