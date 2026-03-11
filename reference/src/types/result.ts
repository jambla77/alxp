import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";
import { MerkleProvenanceTree } from "./merkle.js";

/** Task output — the work product */
export const TaskOutput = z.object({
  name: z.string(),
  mimeType: z.string().default("text/plain"),
  data: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});
export type TaskOutput = z.infer<typeof TaskOutput>;

/** Provenance record — what process produced this result */
export const ProvenanceRecord = z.object({
  agentId: DID,
  modelId: z.string().optional(),
  startedAt: ISO8601,
  completedAt: ISO8601,
  description: z.string().optional(),
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecord>;

/** Tool trace — what tools were called during execution */
export const ToolTrace = z.object({
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
  timestamp: ISO8601,
  durationMs: z.number().nonnegative().optional(),
});
export type ToolTrace = z.infer<typeof ToolTrace>;

/** Test result from acceptance criteria */
export const TestResult = z.object({
  name: z.string(),
  passed: z.boolean(),
  details: z.string().optional(),
});
export type TestResult = z.infer<typeof TestResult>;

/** Worker's self-assessment */
export const SelfAssessment = z.object({
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
  caveats: z.array(z.string()).optional(),
});
export type SelfAssessment = z.infer<typeof SelfAssessment>;

/** Compute report for billing transparency */
export const ComputeReport = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalDurationMs: z.number().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
});
export type ComputeReport = z.infer<typeof ComputeReport>;

/** Environment attestation */
export const Attestation = z.object({
  type: z.string(),
  evidence: z.string(),
});
export type Attestation = z.infer<typeof Attestation>;

/** Result Bundle — what the worker submits back */
export const ResultBundle = z.object({
  id: ULID,
  contractId: ULID,
  worker: DID,
  submitted: ISO8601,

  // The actual output
  outputs: z.array(TaskOutput),

  // Provenance and evidence
  provenance: ProvenanceRecord,
  toolTraces: z.array(ToolTrace).optional(),
  subtaskResults: z.array(ULID).optional(),

  // Verification aids
  testResults: z.array(TestResult).optional(),
  selfAssessment: SelfAssessment.optional(),
  environmentAttestation: Attestation.optional(),

  // Metadata
  computeUsed: ComputeReport.optional(),

  // Provenance tree (Tier 2+ verification)
  provenanceTree: MerkleProvenanceTree.optional(),
  provenanceRootHash: z.string().optional(),

  signature: Signature,
});
export type ResultBundle = z.infer<typeof ResultBundle>;
