# ALXP Reference Implementation — Architecture Summary

## Directory Tree

```
./examples/ollama-to-cloud/index.ts
./examples/simple-requester/index.ts
./examples/simple-worker/index.ts
./src/context/encryption.ts
./src/context/envelope.ts
./src/delegation/subtask.ts
./src/discovery/agent-card.ts
./src/discovery/registry.ts
./src/identity/did.ts
./src/identity/signing.ts
./src/identity/ucan.ts
./src/index.ts
./src/lifecycle/dispute.ts
./src/lifecycle/state-machine.ts
./src/messages/canonicalize.ts
./src/messages/envelope.ts
./src/messages/handlers.ts
./src/messages/validation.ts
./src/reputation/profile.ts
./src/schemas/generate.ts
./src/settlement/adapter.ts
./src/transport/http-client.ts
./src/transport/http-server.ts
./src/transport/webhook.ts
./src/types/agent.ts
./src/types/context.ts
./src/types/contract.ts
./src/types/dispute.ts
./src/types/index.ts
./src/types/message.ts
./src/types/offer.ts
./src/types/primitives.ts
./src/types/receipt.ts
./src/types/result.ts
./src/types/task.ts
./tests/discovery.test.ts
./tests/dispute.test.ts
./tests/encryption.test.ts
./tests/identity.test.ts
./tests/integration/two-agent-exchange.test.ts
./tests/lifecycle.test.ts
./tests/messages.test.ts
./tests/reputation.test.ts
./tests/settlement.test.ts
./tests/subtask.test.ts
./tests/ucan.test.ts
./tests/webhook.test.ts
./tsup.config.ts
```

---

## All TypeScript Type Definitions

### `src/types/primitives.ts`

```typescript
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
```

### `src/types/agent.ts`

```typescript
import { z } from "zod";
import {
  DID,
  ISO8601,
  PublicKey,
  Signature,
  ServiceEndpoint,
  CostModel,
  AvailabilityInfo,
  TrustTier,
  Duration,
} from "./primitives.js";

/** Machine-parseable capability declaration */
export const CapabilityDescription = z.object({
  domain: z.string(),
  subDomain: z.string().optional(),
  confidenceLevel: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).optional(),
  constraints: z
    .object({
      maxInputTokens: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      maxDuration: Duration.optional(),
      requiredContext: z.array(z.string()).optional(),
    })
    .optional(),
  tags: z.array(z.string()),
});
export type CapabilityDescription = z.infer<typeof CapabilityDescription>;

/** Tool description (MCP-compatible) */
export const ToolDescription = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type ToolDescription = z.infer<typeof ToolDescription>;

/** Model information */
export const ModelInfo = z.object({
  provider: z.string().optional(),
  modelId: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** Agent Description — the "resume" of an agent */
export const AgentDescription = z.object({
  // Identity
  id: DID,
  publicKey: PublicKey,
  owner: DID.optional(),
  endpoints: z.array(ServiceEndpoint),

  // Capabilities
  capabilities: z.array(CapabilityDescription),
  tools: z.array(ToolDescription).default([]),
  modelInfo: ModelInfo.optional(),

  // Operational
  costModel: CostModel.optional(),
  availability: AvailabilityInfo,
  jurisdictions: z.array(z.string()).optional(),
  trustTier: TrustTier,

  // Metadata
  created: ISO8601,
  updated: ISO8601,
  signature: Signature,
});
export type AgentDescription = z.infer<typeof AgentDescription>;
```

### `src/types/task.ts`

```typescript
import { z } from "zod";
import {
  DID,
  ISO8601,
  ULID,
  Signature,
  Budget,
  PrivacyClass,
  DelegationPolicy,
  AcceptanceCriteria,
  VerificationMethod,
  Priority,
  AsyncConfig,
} from "./primitives.js";

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
  signature: Signature,
});
export type TaskSpec = z.infer<typeof TaskSpec>;
```

### `src/types/offer.ts`

```typescript
import { z } from "zod";
import { DID, ISO8601, ULID, Duration, Price, Signature } from "./primitives.js";

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

  signature: Signature,
});
export type Offer = z.infer<typeof Offer>;
```

### `src/types/contract.ts`

```typescript
import { z } from "zod";
import { DID, ISO8601, ULID, Price, Signature, CancellationPolicy } from "./primitives.js";
import { VerificationPlan } from "./offer.js";

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

  // Cancellation terms
  cancellationPolicy: CancellationPolicy,

  // Signatures from BOTH parties
  requesterSignature: Signature,
  workerSignature: Signature,

  formed: ISO8601,
});
export type TaskContract = z.infer<typeof TaskContract>;
```

### `src/types/context.ts`

```typescript
import { z } from "zod";
import {
  DID,
  ISO8601,
  ULID,
  URL_,
  Signature,
  EncryptionInfo,
  RetentionPolicy,
} from "./primitives.js";

/** Context payload — actual data sent to the worker */
export const ContextPayload = z.object({
  name: z.string(),
  mimeType: z.string().default("text/plain"),
  data: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});
export type ContextPayload = z.infer<typeof ContextPayload>;

/** Context reference — pointer to external data */
export const ContextReference = z.object({
  name: z.string(),
  url: URL_,
  mimeType: z.string().optional(),
  accessToken: z.string().optional(),
});
export type ContextReference = z.infer<typeof ContextReference>;

/** Redaction rule — what must be stripped before sub-delegation */
export const RedactionRule = z.object({
  payloadName: z.string(),
  fields: z.array(z.string()).optional(),
  action: z.enum(["remove", "mask", "hash"]),
});
export type RedactionRule = z.infer<typeof RedactionRule>;

/** Context Envelope — secure, scoped context transfer */
export const ContextEnvelope = z.object({
  id: ULID,
  contractId: ULID,
  sender: DID,
  recipient: DID,

  // Content
  payloads: z.array(ContextPayload).default([]),
  references: z.array(ContextReference).default([]),

  // Privacy
  encryption: EncryptionInfo,
  retentionPolicy: RetentionPolicy,
  redactionRules: z.array(RedactionRule).optional(),
  onwardTransfer: z.boolean().default(false),

  // Expiry
  expires: ISO8601,
  revocationEndpoint: URL_.optional(),

  signature: Signature,
});
export type ContextEnvelope = z.infer<typeof ContextEnvelope>;
```

### `src/types/result.ts`

```typescript
import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";

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

  signature: Signature,
});
export type ResultBundle = z.infer<typeof ResultBundle>;
```

### `src/types/receipt.ts`

```typescript
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

  // Both parties sign to prevent fabrication
  requesterSignature: Signature,
  workerSignature: Signature,
});
export type WorkReceipt = z.infer<typeof WorkReceipt>;
```

### `src/types/dispute.ts`

```typescript
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
```

### `src/types/message.ts`

```typescript
import { z } from "zod";
import { DID, ISO8601, ULID, Signature } from "./primitives.js";
import { TaskSpec } from "./task.js";
import { Offer } from "./offer.js";
import { TaskContract } from "./contract.js";
import { ContextEnvelope } from "./context.js";
import { ResultBundle } from "./result.js";
import { WorkReceipt } from "./receipt.js";
import { DisputeRecord } from "./dispute.js";

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

/** Discriminated union of all message payloads */
export const MessagePayload = z.discriminatedUnion("type", [
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
  Settle,
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
```

### `src/types/index.ts`

```typescript
export * from "./primitives.js";
export * from "./agent.js";
export * from "./task.js";
export * from "./offer.js";
export * from "./contract.js";
export * from "./context.js";
export * from "./result.js";
export * from "./receipt.js";
export * from "./dispute.js";
export * from "./message.js";
```

---

## State Machine

### `src/lifecycle/state-machine.ts`

```typescript
import type { TaskState, DID } from "../types/index.js";

/** A state transition definition */
export interface TransitionDef {
  from: TaskState;
  to: TaskState;
  trigger: string;
  requiredSignatures: ("requester" | "worker")[];
}

/** All valid transitions in the task lifecycle */
export const TRANSITIONS: TransitionDef[] = [
  // Happy path
  { from: "POSTED", to: "BIDDING", trigger: "first_offer_received", requiredSignatures: [] },
  { from: "BIDDING", to: "AWARDED", trigger: "offer_accepted", requiredSignatures: ["requester", "worker"] },
  { from: "AWARDED", to: "RUNNING", trigger: "context_transferred", requiredSignatures: ["requester"] },
  { from: "RUNNING", to: "CHECKPOINT", trigger: "progress_report", requiredSignatures: ["worker"] },
  { from: "RUNNING", to: "BLOCKED", trigger: "input_needed", requiredSignatures: ["worker"] },
  { from: "RUNNING", to: "SUBMITTED", trigger: "result_submitted", requiredSignatures: ["worker"] },
  { from: "CHECKPOINT", to: "RUNNING", trigger: "checkpoint_acknowledged", requiredSignatures: [] },
  { from: "BLOCKED", to: "RUNNING", trigger: "input_provided", requiredSignatures: ["requester"] },
  { from: "SUBMITTED", to: "REVIEWING", trigger: "review_started", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "ACCEPTED", trigger: "result_accepted", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "REJECTED", trigger: "result_rejected", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "DISPUTED", trigger: "dispute_raised", requiredSignatures: ["worker"] },
  { from: "ACCEPTED", to: "SETTLED", trigger: "payment_released", requiredSignatures: ["requester", "worker"] },
  { from: "REJECTED", to: "SETTLED", trigger: "partial_payment", requiredSignatures: ["requester", "worker"] },
  { from: "DISPUTED", to: "ARBITRATING", trigger: "arbitration_started", requiredSignatures: [] },
  { from: "ARBITRATING", to: "RESOLVED", trigger: "arbitration_complete", requiredSignatures: [] },

  // Cancellation (from most active states)
  { from: "POSTED", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "BIDDING", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "AWARDED", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "RUNNING", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },

  // Expiration (from states where a deadline can lapse)
  { from: "POSTED", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },
  { from: "BIDDING", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },
  { from: "RUNNING", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },

  // Failure (worker reports inability)
  { from: "RUNNING", to: "FAILED", trigger: "worker_failed", requiredSignatures: ["worker"] },
  { from: "BLOCKED", to: "FAILED", trigger: "worker_failed", requiredSignatures: ["worker"] },
];

/** Lookup table: from -> trigger -> TransitionDef */
const transitionMap = new Map<string, TransitionDef>();
for (const t of TRANSITIONS) {
  transitionMap.set(`${t.from}:${t.trigger}`, t);
}

/** Error thrown when a transition is invalid */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly trigger: string,
  ) {
    super(`Invalid transition: cannot apply "${trigger}" from state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

/** Get the valid transition for a given state and trigger, or null if invalid */
export function getTransition(from: TaskState, trigger: string): TransitionDef | null {
  return transitionMap.get(`${from}:${trigger}`) ?? null;
}

/** Get all valid triggers from a given state */
export function getValidTriggers(from: TaskState): TransitionDef[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/** Check if a transition is valid */
export function isValidTransition(from: TaskState, trigger: string): boolean {
  return transitionMap.has(`${from}:${trigger}`);
}

/**
 * Tracked task state with history.
 * Enforces the state machine transitions.
 */
export class TaskStateMachine {
  private _state: TaskState;
  private _history: { from: TaskState; to: TaskState; trigger: string; timestamp: string }[] = [];

  constructor(
    public readonly taskId: string,
    public readonly requester: DID,
    public readonly worker?: DID,
    initialState: TaskState = "POSTED",
  ) {
    this._state = initialState;
  }

  get state(): TaskState {
    return this._state;
  }

  get history() {
    return [...this._history];
  }

  /** Apply a trigger to transition to the next state */
  transition(trigger: string, signers: ("requester" | "worker")[] = []): TaskState {
    const def = getTransition(this._state, trigger);
    if (!def) {
      throw new InvalidTransitionError(this._state, trigger);
    }

    // Check required signatures
    for (const required of def.requiredSignatures) {
      if (!signers.includes(required)) {
        throw new Error(
          `Transition "${trigger}" from "${this._state}" requires signature from "${required}"`,
        );
      }
    }

    const from = this._state;
    this._state = def.to;
    this._history.push({
      from,
      to: def.to,
      trigger,
      timestamp: new Date().toISOString(),
    });

    return this._state;
  }

  /** Check if a trigger can be applied to the current state */
  canTransition(trigger: string): boolean {
    return isValidTransition(this._state, trigger);
  }

  /** Get all triggers valid from the current state */
  validTriggers(): TransitionDef[] {
    return getValidTriggers(this._state);
  }

  /** Check if the task is in a terminal state */
  isTerminal(): boolean {
    return ["SETTLED", "CANCELLED", "EXPIRED", "FAILED", "RESOLVED"].includes(this._state);
  }
}
```

---

## Message Types

### `src/messages/canonicalize.ts`

```typescript
/**
 * RFC 8785 (JCS) — JSON Canonicalization Scheme.
 *
 * Deterministic JSON serialization for signing.
 * Keys are sorted lexicographically, undefined values are omitted.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) {
        entries.push(`${JSON.stringify(key)}:${canonicalize(val)}`);
      }
    }
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}
```

### `src/messages/envelope.ts`

```typescript
import { ulid } from "ulid";
import { signString, verifyString, hexToPublicKey } from "../identity/signing.js";
import { publicKeyFromDID } from "../identity/did.js";
import { ProtocolMessage, PROTOCOL_VERSION, type MessagePayload, type DID } from "../types/index.js";
import { canonicalize } from "./canonicalize.js";

/** Options for creating a protocol message */
export interface CreateMessageOptions {
  sender: DID;
  privateKey: Uint8Array;
  payload: MessagePayload;
  recipient?: DID;
  replyTo?: string;
  headers?: Record<string, string>;
}

/**
 * Create a signed ProtocolMessage envelope.
 *
 * The signature covers the canonicalized JSON of the message
 * (excluding the signature field itself).
 */
export function createMessage(options: CreateMessageOptions): ProtocolMessage {
  const { sender, privateKey, payload, recipient, replyTo, headers } = options;

  // Build the message without signature
  const unsigned = {
    version: PROTOCOL_VERSION,
    id: ulid(),
    timestamp: new Date().toISOString(),
    sender,
    recipient,
    replyTo,
    payload,
    headers,
    signature: "", // placeholder
  };

  // Canonicalize without signature for signing
  const toSign = canonicalize({ ...unsigned, signature: undefined });
  const signature = signString(toSign, privateKey);

  return { ...unsigned, signature } as ProtocolMessage;
}

/**
 * Verify the signature of a ProtocolMessage.
 * Resolves the sender's public key from their DID.
 */
export function verifyMessage(message: ProtocolMessage): boolean {
  const { signature, ...rest } = message;
  const toVerify = canonicalize({ ...rest, signature: undefined });
  const pubHex = publicKeyFromDID(message.sender);
  const publicKey = hexToPublicKey(pubHex);
  return verifyString(signature, toVerify, publicKey);
}

/**
 * Validate message structure against the Zod schema.
 * Returns parsed message or throws.
 */
export function parseMessage(raw: unknown): ProtocolMessage {
  return ProtocolMessage.parse(raw);
}
```

### `src/messages/handlers.ts`

```typescript
import type { ProtocolMessage, MessagePayload } from "../types/index.js";

/** Handler for a specific message type */
export type MessageHandler<T extends MessagePayload = MessagePayload> = (
  message: ProtocolMessage & { payload: T },
) => Promise<void>;

/** Registry of message handlers */
export class MessageRouter {
  private handlers = new Map<string, MessageHandler[]>();

  /** Register a handler for a message type */
  on<T extends MessagePayload>(
    type: T["type"],
    handler: MessageHandler<T>,
  ): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as MessageHandler);
    this.handlers.set(type, existing);
  }

  /** Route a message to registered handlers */
  async route(message: ProtocolMessage): Promise<void> {
    const handlers = this.handlers.get(message.payload.type) ?? [];
    for (const handler of handlers) {
      await handler(message);
    }
  }

  /** Check if any handlers exist for a message type */
  hasHandler(type: string): boolean {
    return (this.handlers.get(type)?.length ?? 0) > 0;
  }
}
```

### `src/messages/validation.ts`

```typescript
import { ProtocolMessage, TaskSpec, Offer, TaskContract, ResultBundle, WorkReceipt, DisputeRecord } from "../types/index.js";

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a raw object as a ProtocolMessage */
export function validateMessage(raw: unknown): ValidationResult {
  const result = ProtocolMessage.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a TaskSpec */
export function validateTaskSpec(raw: unknown): ValidationResult {
  const result = TaskSpec.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate an Offer */
export function validateOffer(raw: unknown): ValidationResult {
  const result = Offer.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a TaskContract */
export function validateContract(raw: unknown): ValidationResult {
  const result = TaskContract.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a ResultBundle */
export function validateResultBundle(raw: unknown): ValidationResult {
  const result = ResultBundle.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a WorkReceipt */
export function validateWorkReceipt(raw: unknown): ValidationResult {
  const result = WorkReceipt.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a DisputeRecord */
export function validateDisputeRecord(raw: unknown): ValidationResult {
  const result = DisputeRecord.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
```

---

## Identity

### `src/identity/signing.ts`

```typescript
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// ed25519 v3 requires sha512 to be set explicitly
ed25519.hashes.sha512 = sha512;

/** A keypair for Ed25519 signing */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Generate a new Ed25519 keypair */
export function generateKeyPair(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/** Sign a message with a private key */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Verify a signature against a message and public key */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, message, publicKey);
}

/** Sign a UTF-8 string, return hex-encoded signature */
export function signString(data: string, privateKey: Uint8Array): string {
  const message = new TextEncoder().encode(data);
  const sig = sign(message, privateKey);
  return ed25519.etc.bytesToHex(sig);
}

/** Verify a hex-encoded signature against a UTF-8 string */
export function verifyString(
  signatureHex: string,
  data: string,
  publicKey: Uint8Array,
): boolean {
  const message = new TextEncoder().encode(data);
  const sig = ed25519.etc.hexToBytes(signatureHex);
  return verify(sig, message, publicKey);
}

/** Encode a public key as hex string */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return ed25519.etc.bytesToHex(publicKey);
}

/** Decode a hex string to public key bytes */
export function hexToPublicKey(hex: string): Uint8Array {
  return ed25519.etc.hexToBytes(hex);
}
```

### `src/identity/did.ts`

```typescript
import { generateKeyPair, publicKeyToHex, type KeyPair } from "./signing.js";
import type { DID } from "../types/index.js";

/** DID Document (simplified for did:key method) */
export interface DIDDocument {
  "@context": string;
  id: DID;
  verificationMethod: {
    id: string;
    type: string;
    controller: DID;
    publicKeyHex: string;
  }[];
  authentication: string[];
  assertionMethod: string[];
  service?: {
    id: string;
    type: string;
    serviceEndpoint: string;
  }[];
}

/** Agent identity: DID + keypair + optional endpoint */
export interface AgentIdentity {
  did: DID;
  keyPair: KeyPair;
  document: DIDDocument;
}

/**
 * Generate a new agent identity using did:key method.
 * did:key is self-certifying — the DID IS the public key.
 */
export function generateAgentIdentity(endpoint?: string): AgentIdentity {
  const keyPair = generateKeyPair();
  const pubHex = publicKeyToHex(keyPair.publicKey);
  const did: DID = `did:key:z${pubHex}` as DID;

  const document: DIDDocument = {
    "@context": "https://www.w3.org/ns/did/v1",
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex: pubHex,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
  };

  if (endpoint) {
    document.service = [
      {
        id: `${did}#alxp`,
        type: "ALXPEndpoint",
        serviceEndpoint: endpoint,
      },
    ];
  }

  return { did, keyPair, document };
}

/** Extract the public key hex from a did:key DID */
export function publicKeyFromDID(did: DID): string {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Cannot extract public key from non did:key DID: ${did}`);
  }
  return did.slice("did:key:z".length);
}

/** In-memory DID resolver for testing */
export class DIDResolver {
  private documents = new Map<DID, DIDDocument>();

  register(did: DID, document: DIDDocument): void {
    this.documents.set(did, document);
  }

  resolve(did: DID): DIDDocument | null {
    // For did:key, we can resolve from the DID itself
    if (did.startsWith("did:key:z")) {
      const pubHex = publicKeyFromDID(did);
      return {
        "@context": "https://www.w3.org/ns/did/v1",
        id: did,
        verificationMethod: [
          {
            id: `${did}#key-1`,
            type: "Ed25519VerificationKey2020",
            controller: did,
            publicKeyHex: pubHex,
          },
        ],
        authentication: [`${did}#key-1`],
        assertionMethod: [`${did}#key-1`],
      };
    }
    return this.documents.get(did) ?? null;
  }
}
```

### `src/identity/ucan.ts`

```typescript
/**
 * UCAN (User Controlled Authorization Networks) implementation for ALXP.
 *
 * UCANs are delegable, attenuable capability tokens. Key properties:
 * - No central authorization server needed
 * - Delegation chains are cryptographically verifiable
 * - Permissions can only be reduced (attenuated), never escalated
 * - Perfect for recursive sub-delegation (Agent A -> B -> C)
 *
 * This is a self-contained implementation (no external UCAN library needed)
 * that follows the UCAN spec: https://ucan.xyz
 */

import { ulid } from "ulid";
import { signString, verifyString, publicKeyToHex, hexToPublicKey } from "./signing.js";
import { publicKeyFromDID } from "./did.js";
import { canonicalize } from "../messages/canonicalize.js";
import type { DID } from "../types/index.js";
import type { KeyPair } from "./signing.js";

/** A UCAN capability — what action on what resource */
export interface UCANCapability {
  /** Resource URI (e.g., "alxp://context/contract-01HXYZ") */
  with: string;
  /** Action (e.g., "context/read", "task/delegate", "task/submit") */
  can: string;
}

/** A UCAN token — the core authorization primitive */
export interface UCANToken {
  /** Version of the UCAN spec */
  ucv: "0.10.0";
  /** Unique token identifier */
  id: string;
  /** Issuer DID — who is granting the capability */
  iss: DID;
  /** Audience DID — who receives the capability */
  aud: DID;
  /** Capabilities being granted */
  att: UCANCapability[];
  /** Expiration (Unix timestamp in seconds) */
  exp: number;
  /** Not before (Unix timestamp in seconds) */
  nbf?: number;
  /** Nonce for replay protection */
  nnc: string;
  /** Proofs — ULIDs of parent tokens in the delegation chain */
  prf: string[];
  /** Facts — additional claims (not capabilities) */
  fct?: Record<string, unknown>;
  /** Signature of the token by the issuer */
  sig: string;
}

/** Options for creating a UCAN token */
export interface CreateUCANOptions {
  issuer: DID;
  issuerKey: KeyPair;
  audience: DID;
  capabilities: UCANCapability[];
  expiration: Date;
  notBefore?: Date;
  proofs?: string[];
  facts?: Record<string, unknown>;
}

/** Result of UCAN verification */
export interface UCANVerifyResult {
  valid: boolean;
  errors: string[];
  /** The full delegation chain if valid */
  chain?: UCANToken[];
}

// ── Well-known ALXP capability actions ──

export const ALXP_CAPABILITIES = {
  /** Read context associated with a task */
  CONTEXT_READ: "context/read",
  /** Write/provide context */
  CONTEXT_WRITE: "context/write",
  /** Submit results for a task */
  TASK_SUBMIT: "task/submit",
  /** Delegate task to another agent */
  TASK_DELEGATE: "task/delegate",
  /** Verify/review submitted work */
  TASK_VERIFY: "task/verify",
  /** Wildcard — all actions on a resource */
  ALL: "*",
} as const;

/**
 * Create a new UCAN token.
 *
 * The issuer signs the token, granting capabilities to the audience.
 * If proofs are provided, this is a delegation (attenuation of a parent token).
 */
export function createUCAN(options: CreateUCANOptions): UCANToken {
  const {
    issuer,
    issuerKey,
    audience,
    capabilities,
    expiration,
    notBefore,
    proofs = [],
    facts,
  } = options;

  const token: Omit<UCANToken, "sig"> & { sig?: string } = {
    ucv: "0.10.0",
    id: ulid(),
    iss: issuer,
    aud: audience,
    att: capabilities,
    exp: Math.floor(expiration.getTime() / 1000),
    nbf: notBefore ? Math.floor(notBefore.getTime() / 1000) : undefined,
    nnc: ulid(),
    prf: proofs,
    fct: facts,
  };

  // Sign the canonical representation of the token (without the signature)
  const payload = canonicalize(token);
  token.sig = signString(payload, issuerKey.privateKey);

  return token as UCANToken;
}

/**
 * Verify a UCAN token's signature.
 *
 * This checks:
 * 1. The signature is valid for the issuer's public key
 * 2. The token has not expired
 * 3. The token's notBefore time has passed (if set)
 */
export function verifyUCAN(token: UCANToken, now?: Date): UCANVerifyResult {
  const errors: string[] = [];
  const currentTime = Math.floor((now ?? new Date()).getTime() / 1000);

  // Check expiration
  if (token.exp <= currentTime) {
    errors.push(`Token expired at ${new Date(token.exp * 1000).toISOString()}`);
  }

  // Check notBefore
  if (token.nbf !== undefined && token.nbf > currentTime) {
    errors.push(`Token not valid until ${new Date(token.nbf * 1000).toISOString()}`);
  }

  // Verify signature
  const { sig, ...unsigned } = token;
  const payload = canonicalize(unsigned);

  try {
    const pubHex = publicKeyFromDID(token.iss);
    const publicKey = hexToPublicKey(pubHex);
    if (!verifyString(sig, payload, publicKey)) {
      errors.push("Invalid signature");
    }
  } catch (err) {
    errors.push(`Cannot resolve issuer key: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    chain: errors.length === 0 ? [token] : undefined,
  };
}

/**
 * Delegate (attenuate) a UCAN token.
 *
 * The audience of the parent token becomes the issuer of the child token.
 * The child token's capabilities must be a subset of the parent's.
 * This enforces the UCAN principle: delegation can only attenuate, never escalate.
 */
export function delegateUCAN(
  parentToken: UCANToken,
  options: {
    delegatorKey: KeyPair;
    audience: DID;
    capabilities: UCANCapability[];
    expiration: Date;
    notBefore?: Date;
    facts?: Record<string, unknown>;
  },
): UCANToken {
  const { delegatorKey, audience, capabilities, expiration, notBefore, facts } = options;

  // The delegator must be the audience of the parent token
  const delegatorDid = `did:key:z${publicKeyToHex(delegatorKey.publicKey)}` as DID;
  if (delegatorDid !== parentToken.aud) {
    throw new Error(
      `Delegator ${delegatorDid} is not the audience of the parent token (${parentToken.aud})`,
    );
  }

  // Validate attenuation — child capabilities must be a subset of parent's
  for (const childCap of capabilities) {
    if (!isCapabilitySubset(childCap, parentToken.att)) {
      throw new AttenuationError(childCap, parentToken.att);
    }
  }

  // Child expiration cannot exceed parent's
  const parentExpMs = parentToken.exp * 1000;
  if (expiration.getTime() > parentExpMs) {
    throw new Error(
      `Delegated token expiration (${expiration.toISOString()}) exceeds parent expiration (${new Date(parentExpMs).toISOString()})`,
    );
  }

  return createUCAN({
    issuer: delegatorDid,
    issuerKey: delegatorKey,
    audience,
    capabilities,
    expiration,
    notBefore,
    proofs: [parentToken.id],
    facts,
  });
}

/**
 * Verify a full delegation chain.
 *
 * Given a token and a store of parent tokens, verifies:
 * 1. Each token in the chain has a valid signature
 * 2. Each delegation is properly attenuated
 * 3. The chain is unbroken (each proof resolves to a valid parent)
 * 4. No token in the chain has expired
 */
export function verifyDelegationChain(
  token: UCANToken,
  tokenStore: UCANTokenStore,
  now?: Date,
): UCANVerifyResult {
  const errors: string[] = [];
  const chain: UCANToken[] = [];

  // Verify the leaf token itself
  const leafResult = verifyUCAN(token, now);
  if (!leafResult.valid) {
    return leafResult;
  }
  chain.push(token);

  // Walk up the proof chain
  let current = token;
  while (current.prf.length > 0) {
    const parentId = current.prf[0]!;
    const parent = tokenStore.get(parentId);

    if (!parent) {
      errors.push(`Proof token not found: ${parentId}`);
      break;
    }

    // Verify parent signature
    const parentResult = verifyUCAN(parent, now);
    if (!parentResult.valid) {
      errors.push(...parentResult.errors.map((e) => `Parent ${parentId}: ${e}`));
      break;
    }

    // Verify delegation link: current.iss must equal parent.aud
    if (current.iss !== parent.aud) {
      errors.push(
        `Broken chain: token ${current.id} issuer (${current.iss}) != parent ${parentId} audience (${parent.aud})`,
      );
      break;
    }

    // Verify attenuation: current capabilities must be subset of parent's
    for (const cap of current.att) {
      if (!isCapabilitySubset(cap, parent.att)) {
        errors.push(
          `Escalation in chain: capability ${cap.can} on ${cap.with} not granted by parent ${parentId}`,
        );
      }
    }

    chain.push(parent);
    current = parent;
  }

  return {
    valid: errors.length === 0,
    errors,
    chain: errors.length === 0 ? chain : undefined,
  };
}

/**
 * Check if a capability is a subset of (granted by) a set of parent capabilities.
 *
 * A capability is considered a subset if:
 * - There exists a parent capability with the same or broader resource scope
 * - The parent capability grants the same or broader action
 *
 * Resource scoping: "alxp://context/contract-01" is a subset of "alxp://context/*"
 * Action scoping: "context/read" is a subset of "*"
 */
export function isCapabilitySubset(
  child: UCANCapability,
  parentCaps: UCANCapability[],
): boolean {
  return parentCaps.some((parent) => {
    const resourceMatch = isResourceSubset(child.with, parent.with);
    const actionMatch = isActionSubset(child.can, parent.can);
    return resourceMatch && actionMatch;
  });
}

/** Check if a child resource URI is within the scope of a parent resource URI */
function isResourceSubset(child: string, parent: string): boolean {
  if (parent === child) return true;
  if (parent === "*") return true;

  // Wildcard matching: "alxp://context/*" covers "alxp://context/contract-01"
  if (parent.endsWith("/*")) {
    const prefix = parent.slice(0, -1); // Remove the *
    return child.startsWith(prefix);
  }

  // Prefix matching: "alxp://context/contract-01" covers "alxp://context/contract-01/payload-1"
  if (child.startsWith(parent + "/")) return true;

  return false;
}

/** Check if a child action is within the scope of a parent action */
function isActionSubset(child: string, parent: string): boolean {
  if (parent === child) return true;
  if (parent === "*") return true;

  // Namespace prefix: "context/*" covers "context/read"
  if (parent.endsWith("/*")) {
    const prefix = parent.slice(0, -2);
    return child.startsWith(prefix + "/") || child === prefix;
  }

  return false;
}

/** Error thrown when a delegation attempts to escalate capabilities */
export class AttenuationError extends Error {
  constructor(
    public readonly requested: UCANCapability,
    public readonly available: UCANCapability[],
  ) {
    const availStr = available.map((c) => `${c.can} on ${c.with}`).join(", ");
    super(
      `Cannot delegate "${requested.can}" on "${requested.with}" — not covered by available capabilities: [${availStr}]`,
    );
    this.name = "AttenuationError";
  }
}

/** Simple in-memory token store for resolving proof chains */
export class UCANTokenStore {
  private tokens = new Map<string, UCANToken>();

  store(token: UCANToken): void {
    this.tokens.set(token.id, token);
  }

  get(id: string): UCANToken | null {
    return this.tokens.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.tokens.has(id);
  }

  /** Get all tokens issued by a specific DID */
  issuedBy(did: DID): UCANToken[] {
    return [...this.tokens.values()].filter((t) => t.iss === did);
  }

  /** Get all tokens granted to a specific DID */
  grantedTo(did: DID): UCANToken[] {
    return [...this.tokens.values()].filter((t) => t.aud === did);
  }
}
```

---

## Transport

### `src/transport/http-server.ts`

```typescript
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import type { ProtocolMessage, MessagePayload } from "../types/index.js";
import { parseMessage, verifyMessage } from "../messages/envelope.js";
import { MessageRouter } from "../messages/handlers.js";

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
  id: number | string;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

/** Method name to payload type mapping */
const METHOD_MAP: Record<string, MessagePayload["type"]> = {
  "alxp.announceTask": "ANNOUNCE_TASK",
  "alxp.bid": "BID",
  "alxp.award": "AWARD",
  "alxp.submitResult": "SUBMIT_RESULT",
  "alxp.verify": "VERIFY",
  "alxp.settle": "SETTLE",
};

/** ALXP HTTP Server using JSON-RPC 2.0 over HTTPS */
export class ALXPServer {
  readonly app: Hono;
  readonly router: MessageRouter;
  private server: ServerType | null = null;

  constructor() {
    this.app = new Hono();
    this.router = new MessageRouter();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.post("/alxp", async (c) => {
      let rpcRequest: JsonRpcRequest;
      try {
        rpcRequest = await c.req.json();
      } catch {
        return c.json(this.rpcError(null, -32700, "Parse error"), 200);
      }

      // Validate JSON-RPC structure
      if (rpcRequest.jsonrpc !== "2.0" || !rpcRequest.method || rpcRequest.id == null) {
        return c.json(this.rpcError(rpcRequest.id ?? null, -32600, "Invalid Request"), 200);
      }

      // Check method
      const expectedType = METHOD_MAP[rpcRequest.method];
      if (!expectedType) {
        return c.json(
          this.rpcError(rpcRequest.id, -32601, `Method not found: ${rpcRequest.method}`),
          200,
        );
      }

      // Parse and validate the protocol message
      let message: ProtocolMessage;
      try {
        message = parseMessage(rpcRequest.params);
      } catch (err) {
        return c.json(
          this.rpcError(rpcRequest.id, -32602, `Invalid params: ${err instanceof Error ? err.message : String(err)}`),
          200,
        );
      }

      // Verify that the payload type matches the method
      if (message.payload.type !== expectedType) {
        return c.json(
          this.rpcError(
            rpcRequest.id,
            -32602,
            `Payload type "${message.payload.type}" does not match method "${rpcRequest.method}"`,
          ),
          200,
        );
      }

      // Verify message signature
      if (!verifyMessage(message)) {
        return c.json(
          this.rpcError(rpcRequest.id, -32003, "Invalid message signature"),
          200,
        );
      }

      // Route to handler
      try {
        await this.router.route(message);
      } catch (err) {
        return c.json(
          this.rpcError(rpcRequest.id, -32000, `Handler error: ${err instanceof Error ? err.message : String(err)}`),
          200,
        );
      }

      return c.json(this.rpcSuccess(rpcRequest.id, { status: "ok", messageId: message.id }), 200);
    });
  }

  /** Start the server */
  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port }, () => resolve());
    });
  }

  /** Stop the server */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private rpcSuccess(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", result, id: id ?? 0 };
  }

  private rpcError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", error: { code, message, data }, id: id ?? 0 };
  }
}
```

### `src/transport/http-client.ts`

```typescript
import type { ProtocolMessage, MessagePayload } from "../types/index.js";
import { createMessage } from "../messages/envelope.js";
import type { DID } from "../types/index.js";

/** Payload type to JSON-RPC method mapping */
const TYPE_TO_METHOD: Record<MessagePayload["type"], string> = {
  ANNOUNCE_TASK: "alxp.announceTask",
  BID: "alxp.bid",
  AWARD: "alxp.award",
  SUBMIT_RESULT: "alxp.submitResult",
  VERIFY: "alxp.verify",
  SETTLE: "alxp.settle",
};

/** JSON-RPC response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: { status: string; messageId: string };
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

/** ALXP HTTP Client — sends signed messages to remote agents */
export class ALXPClient {
  private rpcId = 0;

  constructor(
    private readonly senderDid: DID,
    private readonly privateKey: Uint8Array,
  ) {}

  /** Send a signed message to a remote agent */
  async send(
    endpoint: string,
    payload: MessagePayload,
    options?: { recipient?: DID; replyTo?: string },
  ): Promise<JsonRpcResponse> {
    const message = createMessage({
      sender: this.senderDid,
      privateKey: this.privateKey,
      payload,
      recipient: options?.recipient,
      replyTo: options?.replyTo,
    });

    return this.sendRaw(endpoint, message);
  }

  /** Send a pre-constructed ProtocolMessage */
  async sendRaw(endpoint: string, message: ProtocolMessage): Promise<JsonRpcResponse> {
    const method = TYPE_TO_METHOD[message.payload.type];
    if (!method) {
      throw new Error(`Unknown payload type: ${message.payload.type}`);
    }

    const rpcRequest = {
      jsonrpc: "2.0" as const,
      method,
      params: message,
      id: ++this.rpcId,
    };

    const response = await fetch(`${endpoint}/alxp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcRequest),
    });

    return (await response.json()) as JsonRpcResponse;
  }
}
```

---

## Test Files

### `tests/integration/two-agent-exchange.test.ts`

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity, type AgentIdentity } from "../../src/identity/did.js";
import { signString, publicKeyToHex } from "../../src/identity/signing.js";
import { createMessage, verifyMessage } from "../../src/messages/envelope.js";
import { ALXPServer } from "../../src/transport/http-server.js";
import { ALXPClient } from "../../src/transport/http-client.js";
import { TaskStateMachine } from "../../src/lifecycle/state-machine.js";
import type {
  ProtocolMessage,
  AnnounceTask,
  Bid,
  Award,
  SubmitResult,
  Verify,
  Settle,
} from "../../src/types/index.js";

/**
 * Integration test: Two agents complete a full task exchange.
 *
 * 1. Agent A (requester) generates a DID and starts an ALXP server
 * 2. Agent B (worker) generates a DID and starts an ALXP server
 * 3. Agent A announces a task: "Summarize this paragraph"
 * 4. Agent B discovers the task and submits a bid
 * 5. Agent A accepts the bid → TaskContract formed
 * 6. Agent A sends context (the paragraph) in the Award message
 * 7. Agent B "processes" the task (mock: returns a summary)
 * 8. Agent B submits a ResultBundle
 * 9. Agent A verifies (schema check) and accepts
 * 10. WorkReceipt is issued, signed by both parties
 * 11. Assert: all state transitions were valid
 * 12. Assert: all messages have valid signatures
 * 13. Assert: WorkReceipt is dual-signed
 */
describe("Two-agent task exchange", () => {
  let agentA: AgentIdentity;
  let agentB: AgentIdentity;
  let serverA: ALXPServer;
  let serverB: ALXPServer;
  let clientA: ALXPClient;
  let clientB: ALXPClient;

  const PORT_A = 9710;
  const PORT_B = 9711;

  const allMessages: ProtocolMessage[] = [];

  afterAll(async () => {
    await serverA?.close();
    await serverB?.close();
  });

  it("completes the full lifecycle", async () => {
    // ── Step 1: Both agents generate identities and start servers ──
    agentA = generateAgentIdentity(`http://localhost:${PORT_A}`);
    agentB = generateAgentIdentity(`http://localhost:${PORT_B}`);

    serverA = new ALXPServer();
    serverB = new ALXPServer();

    // Track state machine for the task
    const taskId = ulid();
    const sm = new TaskStateMachine(taskId, agentA.did, agentB.did);

    // ── Set up handlers ──
    // Agent B receives ANNOUNCE_TASK and AWARD messages
    const receivedByB: ProtocolMessage[] = [];
    serverB.router.on("ANNOUNCE_TASK", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("AWARD", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("VERIFY", async (msg) => {
      receivedByB.push(msg);
    });
    serverB.router.on("SETTLE", async (msg) => {
      receivedByB.push(msg);
    });

    // Agent A receives BID, SUBMIT_RESULT messages
    const receivedByA: ProtocolMessage[] = [];
    serverA.router.on("BID", async (msg) => {
      receivedByA.push(msg);
    });
    serverA.router.on("SUBMIT_RESULT", async (msg) => {
      receivedByA.push(msg);
    });

    await serverA.listen(PORT_A);
    await serverB.listen(PORT_B);

    clientA = new ALXPClient(agentA.did, agentA.keyPair.privateKey);
    clientB = new ALXPClient(agentB.did, agentB.keyPair.privateKey);

    // ── Step 3: Agent A announces a task ──
    const taskSpec = {
      id: taskId,
      requester: agentA.did,
      created: new Date().toISOString(),
      objective: "Summarize this paragraph into one sentence",
      domain: "summarization",
      inputs: [
        {
          name: "paragraph",
          mimeType: "text/plain",
          data: "The Agent Labor Exchange Protocol enables AI agents to request, negotiate, and complete tasks for other AI agents. It provides a standardized way for agents to exchange labor across different model providers and hosting environments.",
        },
      ],
      expectedOutput: {
        mimeType: "text/plain",
        description: "A one-sentence summary",
      },
      privacyClass: "public" as const,
      delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
      acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
      verificationMethod: "optimistic" as const,
      tags: ["summarization", "test"],
      signature: signString(taskId, agentA.keyPair.privateKey),
    };

    const announceMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec } satisfies AnnounceTask,
      recipient: agentB.did,
    });
    allMessages.push(announceMsg);

    const announceResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, announceMsg);
    expect(announceResp.result).toBeDefined();
    expect(receivedByB).toHaveLength(1);

    // Transition: POSTED → BIDDING
    sm.transition("first_offer_received");
    expect(sm.state).toBe("BIDDING");

    // ── Step 4: Agent B submits a bid ──
    const offerId = ulid();
    const offer = {
      id: offerId,
      taskId,
      worker: agentB.did,
      created: new Date().toISOString(),
      expires: new Date(Date.now() + 3600000).toISOString(),
      price: { amount: 0.01, currency: "USD", model: "fixed" as const },
      estimatedDuration: "PT5M",
      confidence: 0.95,
      requiredContext: [],
      relevantReputation: [],
      relevantCredentials: [],
      signature: signString(offerId, agentB.keyPair.privateKey),
    };

    const bidMsg = createMessage({
      sender: agentB.did,
      privateKey: agentB.keyPair.privateKey,
      payload: { type: "BID", offer } satisfies Bid,
      recipient: agentA.did,
    });
    allMessages.push(bidMsg);

    const bidResp = await clientB.sendRaw(`http://localhost:${PORT_A}`, bidMsg);
    expect(bidResp.result).toBeDefined();
    expect(receivedByA).toHaveLength(1);

    // ── Step 5: Agent A accepts the bid → TaskContract formed ──
    // Transition: BIDDING → AWARDED
    sm.transition("offer_accepted", ["requester", "worker"]);
    expect(sm.state).toBe("AWARDED");

    const contractId = ulid();
    const contract = {
      id: contractId,
      taskId,
      offerId,
      requester: agentA.did,
      worker: agentB.did,
      agreedPrice: { amount: 0.01, currency: "USD", model: "fixed" as const },
      agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
      agreedVerification: { method: "schema-check", description: "Output must be a string" },
      delegationGrant: {
        issuer: agentA.did,
        audience: agentB.did,
        capabilities: ["context/read"],
        expiration: new Date(Date.now() + 3600000).toISOString(),
        token: signString(`${contractId}:grant`, agentA.keyPair.privateKey),
      },
      cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
      requesterSignature: signString(contractId, agentA.keyPair.privateKey),
      workerSignature: signString(contractId, agentB.keyPair.privateKey),
      formed: new Date().toISOString(),
    };

    // ── Step 6: Send Award with context ──
    const contextEnvelope = {
      id: ulid(),
      contractId,
      sender: agentA.did,
      recipient: agentB.did,
      payloads: [
        {
          name: "paragraph",
          mimeType: "text/plain",
          data: taskSpec.inputs[0]!.data!,
          encoding: "utf-8" as const,
        },
      ],
      references: [],
      encryption: {
        algorithm: "none",
        recipientPublicKey: publicKeyToHex(agentB.keyPair.publicKey),
      },
      retentionPolicy: { deleteOnCompletion: true },
      onwardTransfer: false,
      expires: new Date(Date.now() + 3600000).toISOString(),
      signature: signString(contractId + ":context", agentA.keyPair.privateKey),
    };

    const awardMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: { type: "AWARD", contract, contextEnvelope } satisfies Award,
      recipient: agentB.did,
    });
    allMessages.push(awardMsg);

    const awardResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, awardMsg);
    expect(awardResp.result).toBeDefined();

    // Transition: AWARDED → RUNNING
    sm.transition("context_transferred", ["requester"]);
    expect(sm.state).toBe("RUNNING");

    // ── Step 7 & 8: Agent B "processes" the task and submits result ──
    const resultId = ulid();
    const resultBundle = {
      id: resultId,
      contractId,
      worker: agentB.did,
      submitted: new Date().toISOString(),
      outputs: [
        {
          name: "summary",
          mimeType: "text/plain",
          data: "ALXP is a protocol that standardizes AI agent labor exchange across providers and environments.",
          encoding: "utf-8" as const,
        },
      ],
      provenance: {
        agentId: agentB.did,
        modelId: "test-model",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date().toISOString(),
        description: "Summarized the paragraph into one sentence",
      },
      selfAssessment: {
        confidence: 0.9,
        notes: "Straightforward summarization task",
      },
      signature: signString(resultId, agentB.keyPair.privateKey),
    };

    // Transition: RUNNING → SUBMITTED
    sm.transition("result_submitted", ["worker"]);
    expect(sm.state).toBe("SUBMITTED");

    const submitMsg = createMessage({
      sender: agentB.did,
      privateKey: agentB.keyPair.privateKey,
      payload: { type: "SUBMIT_RESULT", result: resultBundle } satisfies SubmitResult,
      recipient: agentA.did,
    });
    allMessages.push(submitMsg);

    const submitResp = await clientB.sendRaw(`http://localhost:${PORT_A}`, submitMsg);
    expect(submitResp.result).toBeDefined();

    // ── Step 9: Agent A verifies and accepts ──
    // Transition: SUBMITTED → REVIEWING
    sm.transition("review_started", ["requester"]);
    expect(sm.state).toBe("REVIEWING");

    // Verify the output (simple schema check: it's a string)
    const output = resultBundle.outputs[0]!.data;
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);

    // Transition: REVIEWING → ACCEPTED
    sm.transition("result_accepted", ["requester"]);
    expect(sm.state).toBe("ACCEPTED");

    // ── Step 10: Issue WorkReceipt, signed by both parties ──
    const receiptId = ulid();
    const receipt = {
      id: receiptId,
      contractId,
      taskId,
      requester: agentA.did,
      worker: agentB.did,
      status: "accepted" as const,
      acceptedAt: new Date().toISOString(),
      qualityScore: 0.9,
      timelinessScore: 1.0,
      taskDomain: "summarization",
      taskComplexity: 0.3,
      amountSettled: { amount: 0.01, currency: "USD", model: "fixed" as const },
      requesterSignature: signString(receiptId, agentA.keyPair.privateKey),
      workerSignature: signString(receiptId, agentB.keyPair.privateKey),
    };

    const verifyMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: {
        type: "VERIFY",
        contractId,
        verdict: "accepted",
        receipt,
      } satisfies Verify,
      recipient: agentB.did,
    });
    allMessages.push(verifyMsg);

    const verifyResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, verifyMsg);
    expect(verifyResp.result).toBeDefined();

    // ── Settlement ──
    // Transition: ACCEPTED → SETTLED
    sm.transition("payment_released", ["requester", "worker"]);
    expect(sm.state).toBe("SETTLED");

    const settleMsg = createMessage({
      sender: agentA.did,
      privateKey: agentA.keyPair.privateKey,
      payload: {
        type: "SETTLE",
        contractId,
        receipt,
      } satisfies Settle,
      recipient: agentB.did,
    });
    allMessages.push(settleMsg);

    const settleResp = await clientA.sendRaw(`http://localhost:${PORT_B}`, settleMsg);
    expect(settleResp.result).toBeDefined();

    // ── Assertions ──

    // 11. Assert: all state transitions were valid
    expect(sm.isTerminal()).toBe(true);
    expect(sm.state).toBe("SETTLED");
    // 7 transitions: first_offer_received, offer_accepted, context_transferred,
    // result_submitted, review_started, result_accepted, payment_released
    expect(sm.history).toHaveLength(7);

    // Verify the full transition path
    const states = sm.history.map((h) => h.to);
    expect(states).toEqual([
      "BIDDING",
      "AWARDED",
      "RUNNING",
      "SUBMITTED",
      "REVIEWING",
      "ACCEPTED",
      "SETTLED",
    ]);

    // 12. Assert: all messages have valid signatures
    for (const msg of allMessages) {
      expect(verifyMessage(msg)).toBe(true);
    }

    // 13. Assert: WorkReceipt is dual-signed
    expect(receipt.requesterSignature).toBeTruthy();
    expect(receipt.workerSignature).toBeTruthy();

    // Verify requester's receipt signature
    const requesterSigValid = (await import("../../src/identity/signing.js")).verifyString(
      receipt.requesterSignature,
      receiptId,
      agentA.keyPair.publicKey,
    );
    expect(requesterSigValid).toBe(true);

    // Verify worker's receipt signature
    const workerSigValid = (await import("../../src/identity/signing.js")).verifyString(
      receipt.workerSignature,
      receiptId,
      agentB.keyPair.publicKey,
    );
    expect(workerSigValid).toBe(true);

    // Verify messages were received by the correct agents
    expect(receivedByA.length).toBe(2); // BID, SUBMIT_RESULT
    expect(receivedByB.length).toBe(4); // ANNOUNCE_TASK, AWARD, VERIFY, SETTLE
  });
});
```

---

## package.json

### `package.json`

```json
{
  "name": "@alxp/reference",
  "version": "0.1.0",
  "description": "ALXP — Agent Labor Exchange Protocol reference implementation",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "schemas": "tsx src/schemas/generate.ts"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT",
  "dependencies": {
    "@hono/node-server": "^1.19.11",
    "@noble/curves": "^2.0.1",
    "@noble/ed25519": "^3.0.0",
    "@noble/hashes": "^2.0.1",
    "hono": "^4.12.7",
    "ulid": "^3.0.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.4.0",
    "tsup": "^8.5.1",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18",
    "zod-to-json-schema": "^3.25.1"
  }
}
```
