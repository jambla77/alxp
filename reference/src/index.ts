// Types
export * from "./types/index.js";

// Identity
export { generateKeyPair, sign, verify, signString, verifyString, publicKeyToHex, hexToPublicKey, hexToBytes } from "./identity/signing.js";
export { generateAgentIdentity, publicKeyFromDID, DIDResolver } from "./identity/did.js";
export type { AgentIdentity, DIDDocument } from "./identity/did.js";
export type { KeyPair } from "./identity/signing.js";

// UCAN Delegation
export { createUCAN, verifyUCAN, delegateUCAN, verifyDelegationChain, isCapabilitySubset, ALXP_CAPABILITIES, UCANTokenStore, AttenuationError } from "./identity/ucan.js";
export type { UCANToken, UCANCapability, CreateUCANOptions, UCANVerifyResult } from "./identity/ucan.js";

// Lifecycle
export { TaskStateMachine, InvalidTransitionError, getTransition, getValidTriggers, isValidTransition, TRANSITIONS } from "./lifecycle/state-machine.js";

// Disputes
export { DisputeManager } from "./lifecycle/dispute.js";
export type { RaiseDisputeOptions, SubmitEvidenceOptions, ResolveDisputeOptions } from "./lifecycle/dispute.js";

// Messages
export { createMessage, verifyMessage, parseMessage } from "./messages/envelope.js";
export { canonicalize } from "./messages/canonicalize.js";
export { MessageRouter } from "./messages/handlers.js";
export { validateMessage, validateTaskSpec, validateOffer, validateContract, validateResultBundle, validateWorkReceipt, validateDisputeRecord } from "./messages/validation.js";

// Transport
export { ALXPServer } from "./transport/http-server.js";
export { ALXPClient } from "./transport/http-client.js";

// Async (Webhooks + SSE)
export { WebhookPublisher, WebhookReceiver, ProgressStream } from "./transport/webhook.js";
export type { WebhookNotification, WebhookHandler } from "./transport/webhook.js";

// Context Encryption
export { encrypt, decrypt, generateX25519KeyPair, ed25519ToX25519Public, ed25519ToX25519Private } from "./context/encryption.js";
export type { EncryptedPayload, X25519KeyPair } from "./context/encryption.js";
export { createSealedEnvelope, decryptPayload, redactEnvelope, isEnvelopeExpired } from "./context/envelope.js";
export type { CreateContextEnvelopeOptions, SealedContextEnvelope } from "./context/envelope.js";

// Discovery
export { generateAgentCard, matchesQuery, canHandleEffortTier, checkBidEligibility, suggestPromotion, calculateCreditCost, EFFORT_MULTIPLIERS, EFFORT_VERIFICATION } from "./discovery/agent-card.js";
export type { AgentCardOptions, CapabilityQuery, BidEligibilityOptions, BidEligibilityResult, CreditCostOptions } from "./discovery/agent-card.js";
export { AgentRegistry, RegistryServer } from "./discovery/registry.js";
export { TaskBoard, verifyTaskSignature } from "./discovery/task-board.js";
export type { PostedTask, TaskBoardOptions, TaskQuery } from "./discovery/task-board.js";
export { HeartbeatTracker, isWithinWindow, getScheduledCapacity, hasRemainingQuota } from "./discovery/heartbeat.js";
export type { HeartbeatState, HeartbeatTrackerOptions, HeartbeatCallback } from "./discovery/heartbeat.js";

// Reputation
export { ReputationEngine } from "./reputation/profile.js";
export type { ReputationProfile, DomainReputation } from "./reputation/profile.js";

// Settlement
export { MockSettlementAdapter } from "./settlement/adapter.js";
export type { SettlementAdapter, EscrowRef, SettlementProofData } from "./settlement/adapter.js";
export { CreditLedger } from "./settlement/credit-ledger.js";
export type { TransactionOptions } from "./settlement/credit-ledger.js";
export { CreditSettlementAdapter } from "./settlement/credit-adapter.js";

// Sub-delegation
export { SubDelegationManager } from "./delegation/subtask.js";
export type { SubTask, DecomposeOptions } from "./delegation/subtask.js";

// Verification
export { VerificationEngine } from "./verification/index.js";
export type { VerificationResult } from "./verification/index.js";
export { runAutomatedVerification } from "./verification/automated.js";
export type { AutomatedVerificationResult, CheckResult } from "./verification/automated.js";
export { MerkleTreeBuilder } from "./verification/merkle.js";
export { OptimisticVerifier, MockStakingAdapter } from "./verification/economic.js";
export type { StakingAdapter, PendingAcceptance } from "./verification/economic.js";
export { ConsensusVerifier } from "./verification/consensus.js";
export type { ValidatorSelectionConfig, ValidatorAgent } from "./verification/consensus.js";

// Metering
export { MeteringTracker, validateMeteringReport, QuotaConsumptionTracker } from "./metering/tracker.js";
export type { UsageCounters, MeteringValidationResult, MeteringValidationOptions, QuotaCheckResult } from "./metering/tracker.js";
