/**
 * Dispute lifecycle management.
 *
 * When a worker disagrees with a rejection, or a requester believes
 * work was unsatisfactory, disputes follow a structured lifecycle:
 *
 * DISPUTED → (evidence gathering) → ARBITRATING → RESOLVED
 *
 * The protocol supports:
 * - Evidence submission by both parties (signed)
 * - Third-party arbitration
 * - Resolution with configurable outcomes (requester-wins, worker-wins, compromise)
 * - Settlement adjustment based on resolution
 */

import { ulid } from "ulid";
import { signString } from "../identity/signing.js";
import type { DID } from "../types/index.js";
import type {
  DisputeRecord as DisputeRecordType,
  DisputeEvidence as DisputeEvidenceType,
  DisputeResolution as DisputeResolutionType,
} from "../types/dispute.js";
import type { DisputeReason } from "../types/primitives.js";
import type { KeyPair } from "../identity/signing.js";

/** Options for raising a dispute */
export interface RaiseDisputeOptions {
  contractId: string;
  initiator: DID;
  initiatorKey: KeyPair;
  respondent: DID;
  reason: DisputeReason;
  description: string;
  evidence?: string;
}

/** Options for submitting evidence */
export interface SubmitEvidenceOptions {
  submitter: DID;
  submitterKey: KeyPair;
  description: string;
  data?: string;
}

/** Options for resolving a dispute */
export interface ResolveDisputeOptions {
  arbitrator: DID;
  arbitratorKey: KeyPair;
  outcome: "requester-wins" | "worker-wins" | "compromise";
  description: string;
  refundPercent?: number;
}

/**
 * Manages the lifecycle of a single dispute.
 */
export class DisputeManager {
  private _record: DisputeRecordType;

  constructor(options: RaiseDisputeOptions) {
    const disputeId = ulid();
    const now = new Date().toISOString();

    const initialEvidence: DisputeEvidenceType = {
      submitter: options.initiator,
      description: options.description,
      data: options.evidence,
      timestamp: now,
      signature: signString(
        `${disputeId}:evidence:${options.description}`,
        options.initiatorKey.privateKey,
      ),
    };

    this._record = {
      id: disputeId,
      contractId: options.contractId,
      initiator: options.initiator,
      respondent: options.respondent,
      reason: options.reason,
      evidence: [initialEvidence],
      status: "open",
      created: now,
      signatures: [
        signString(disputeId, options.initiatorKey.privateKey),
      ],
    };
  }

  get record(): DisputeRecordType {
    return { ...this._record, evidence: [...this._record.evidence] };
  }

  get id(): string {
    return this._record.id;
  }

  get status(): DisputeRecordType["status"] {
    return this._record.status;
  }

  /** Submit additional evidence (from either party) */
  submitEvidence(options: SubmitEvidenceOptions): void {
    if (this._record.status === "resolved") {
      throw new Error("Cannot submit evidence to a resolved dispute");
    }

    // Only initiator or respondent can submit evidence
    if (
      options.submitter !== this._record.initiator &&
      options.submitter !== this._record.respondent
    ) {
      throw new Error("Only the initiator or respondent can submit evidence");
    }

    const evidence: DisputeEvidenceType = {
      submitter: options.submitter,
      description: options.description,
      data: options.data,
      timestamp: new Date().toISOString(),
      signature: signString(
        `${this._record.id}:evidence:${options.description}`,
        options.submitterKey.privateKey,
      ),
    };

    this._record.evidence.push(evidence);
  }

  /** Begin arbitration by a third party */
  beginArbitration(arbitrator: DID): void {
    if (this._record.status !== "open") {
      throw new Error(`Cannot begin arbitration: dispute is ${this._record.status}`);
    }

    this._record.status = "arbitrating";
    this._record.arbitrator = arbitrator;
  }

  /** Resolve the dispute with an outcome */
  resolve(options: ResolveDisputeOptions): DisputeResolutionType {
    if (this._record.status !== "open" && this._record.status !== "arbitrating") {
      throw new Error(`Cannot resolve: dispute is ${this._record.status}`);
    }

    // If arbitrating, only the assigned arbitrator can resolve
    if (
      this._record.status === "arbitrating" &&
      this._record.arbitrator &&
      options.arbitrator !== this._record.arbitrator
    ) {
      throw new Error("Only the assigned arbitrator can resolve this dispute");
    }

    const resolution: DisputeResolutionType = {
      outcome: options.outcome,
      description: options.description,
      refundPercent: options.refundPercent,
      timestamp: new Date().toISOString(),
    };

    this._record.status = "resolved";
    this._record.resolution = resolution;
    this._record.resolved = new Date().toISOString();
    this._record.arbitrator = options.arbitrator;
    this._record.signatures.push(
      signString(`${this._record.id}:resolved`, options.arbitratorKey.privateKey),
    );

    return resolution;
  }

  /** Check if the dispute is in a terminal state */
  isResolved(): boolean {
    return this._record.status === "resolved";
  }
}
