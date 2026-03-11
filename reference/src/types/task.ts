import { z } from "zod";
import {
  DID,
  ISO8601,
  ULID,
  Signature,
  Budget,
  Price,
  Duration,
  PrivacyClass,
  DelegationPolicy,
  AcceptanceCriteria,
  VerificationMethod,
  Priority,
  EffortTier,
  AsyncConfig,
} from "./primitives.js";
import { SpotCheckConfig } from "./staking.js";
import { EffortEstimate } from "./exchange.js";

/** Task input — context or data for the task */
export const TaskInput = z.object({
  name: z.string(),
  mimeType: z.string().default("text/plain"),
  data: z.string().optional(),
  ref: z.string().url().optional(),
});
export type TaskInput = z.infer<typeof TaskInput>;

/** Expected output schema */
export const OutputSchema = z.object({
  mimeType: z.string().default("text/plain"),
  schema: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});
export type OutputSchema = z.infer<typeof OutputSchema>;

/** Task Specification — the "job posting" */
export const TaskSpec = z.object({
  id: ULID,
  requester: DID,
  created: ISO8601,
  expires: ISO8601.optional(),

  // What
  objective: z.string(),
  domain: z.string(),
  inputs: z.array(TaskInput).default([]),
  expectedOutput: OutputSchema,

  // Constraints
  budget: Budget.optional(),
  deadline: ISO8601.optional(),
  privacyClass: PrivacyClass,
  delegationPolicy: DelegationPolicy,

  // Verification
  acceptanceCriteria: z.array(AcceptanceCriteria),
  verificationMethod: VerificationMethod,

  // Metadata
  priority: Priority.optional(),
  tags: z.array(z.string()).default([]),
  parentTaskId: ULID.optional(),
  asyncConfig: AsyncConfig.optional(),

  // Economic verification (Tier 2)
  stakeRequired: Price.optional(),
  challengeWindow: Duration.optional(),
  spotCheckConfig: SpotCheckConfig.optional(),

  // Exchange layer
  effortTier: EffortTier.optional(),
  effortEstimate: EffortEstimate.optional(),
  creditReward: z.number().nonnegative().optional(),

  signature: Signature,
});
export type TaskSpec = z.infer<typeof TaskSpec>;
