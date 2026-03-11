import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";
import { TaskSpec } from "./task.js";
import { Offer } from "./offer.js";
import { TaskContract } from "./contract.js";
import { ContextEnvelope } from "./context.js";
import { ResultBundle } from "./result.js";
import { WorkReceipt } from "./receipt.js";
import { DisputeRecord } from "./dispute.js";
import { Challenge } from "./staking.js";
import { ValidatorAssessment } from "./consensus.js";
import { MeteringReport, QuotaRemaining } from "./exchange.js";

/** Settlement proof */
export const SettlementProof = z.object({
  type: z.string(),
  ref: z.string(),
  timestamp: ISO8601,
});
export type SettlementProof = z.infer<typeof SettlementProof>;

// ── The Six Core Message Payloads ──

export const AnnounceTask = z.object({
  type: z.literal("ANNOUNCE_TASK"),
  taskSpec: TaskSpec,
});
export type AnnounceTask = z.infer<typeof AnnounceTask>;

export const Bid = z.object({
  type: z.literal("BID"),
  offer: Offer,
});
export type Bid = z.infer<typeof Bid>;

export const Award = z.object({
  type: z.literal("AWARD"),
  contract: TaskContract,
  contextEnvelope: ContextEnvelope.optional(),
});
export type Award = z.infer<typeof Award>;

export const SubmitResult = z.object({
  type: z.literal("SUBMIT_RESULT"),
  result: ResultBundle,
});
export type SubmitResult = z.infer<typeof SubmitResult>;

export const Verify = z.object({
  type: z.literal("VERIFY"),
  contractId: ULID,
  verdict: z.enum(["accepted", "rejected", "disputed"]),
  receipt: WorkReceipt.optional(),
  disputeRecord: DisputeRecord.optional(),
  feedback: z.string().optional(),
});
export type Verify = z.infer<typeof Verify>;

export const Settle = z.object({
  type: z.literal("SETTLE"),
  contractId: ULID,
  receipt: WorkReceipt,
  settlementProof: SettlementProof.optional(),
});
export type Settle = z.infer<typeof Settle>;

/** Challenge a pending result (Tier 2) */
export const ChallengeResult = z.object({
  type: z.literal("CHALLENGE_RESULT"),
  challenge: Challenge,
});
export type ChallengeResult = z.infer<typeof ChallengeResult>;

/** Submit a validator assessment (Tier 3) */
export const ValidatorAssess = z.object({
  type: z.literal("VALIDATOR_ASSESS"),
  assessment: ValidatorAssessment,
});
export type ValidatorAssess = z.infer<typeof ValidatorAssess>;

// ── Exchange Layer Messages ──

/** Agent heartbeat — liveness and capacity signal */
export const Heartbeat = z.object({
  type: z.literal("HEARTBEAT"),
  agentId: DID,
  status: z.enum(["online", "busy", "offline"]),
  capacity: z.number().min(0).max(1),
  currentTasks: z.number().int().nonnegative(),
  quotaRemaining: QuotaRemaining.optional(),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

/** Interim metering update during task execution */
export const MeteringUpdate = z.object({
  type: z.literal("METERING_UPDATE"),
  contractId: ULID,
  report: MeteringReport,
});
export type MeteringUpdate = z.infer<typeof MeteringUpdate>;

/** Discriminated union of all message payloads */
export const MessagePayload = z.discriminatedUnion("type", [
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
  Settle,
  ChallengeResult,
  ValidatorAssess,
  Heartbeat,
  MeteringUpdate,
]);
export type MessagePayload = z.infer<typeof MessagePayload>;

/** Protocol version */
export const PROTOCOL_VERSION = "alxp/0.1" as const;

/** Protocol message envelope — wraps every message on the wire */
export const ProtocolMessage = z.object({
  version: z.literal(PROTOCOL_VERSION),
  id: ULID,
  timestamp: ISO8601,
  sender: DID,
  recipient: DID.optional(),
  replyTo: ULID.optional(),

  payload: MessagePayload,

  headers: z.record(z.string(), z.string()).optional(),

  signature: Signature,
});
export type ProtocolMessage = z.infer<typeof ProtocolMessage>;
