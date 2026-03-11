/**
 * Reputation profile built from dual-signed WorkReceipts.
 *
 * The protocol defines the data format, not the scoring algorithm.
 * Marketplaces compete on how they weight and combine these signals.
 *
 * Key principle: reputation claims are backed by verifiable receipts,
 * not self-reported claims. Only dual-signed WorkReceipts count.
 */

import { verifyString, hexToPublicKey } from "../identity/signing.js";
import { publicKeyFromDID } from "../identity/did.js";
import type { DID } from "../types/index.js";
import type { WorkReceipt } from "../types/receipt.js";

/** Domain-specific reputation scores */
export interface DomainReputation {
  domain: string;
  tasksCompleted: number;
  tasksRejected: number;
  avgQuality: number;
  avgTimeliness: number;
  receiptIds: string[];
}

/** Full reputation profile for an agent */
export interface ReputationProfile {
  agent: DID;
  totalTasksCompleted: number;
  totalTasksPosted: number;
  acceptanceRate: number;
  disputeRate: number;
  avgQualityScore: number;
  avgTimelinessScore: number;
  domainScores: Map<string, DomainReputation>;
  receiptCount: number;
  lastUpdated: string;
}

/**
 * Receipt store and reputation engine.
 *
 * Stores dual-signed WorkReceipts and computes reputation profiles.
 * Verifies receipt signatures before accepting them.
 */
export class ReputationEngine {
  private receipts = new Map<string, WorkReceipt>();
  /** Receipt IDs indexed by worker DID */
  private workerIndex = new Map<DID, string[]>();
  /** Receipt IDs indexed by requester DID */
  private requesterIndex = new Map<DID, string[]>();

  /** Add a verified receipt to the store */
  addReceipt(receipt: WorkReceipt): void {
    this.receipts.set(receipt.id, receipt);

    const workerIds = this.workerIndex.get(receipt.worker) ?? [];
    workerIds.push(receipt.id);
    this.workerIndex.set(receipt.worker, workerIds);

    const requesterIds = this.requesterIndex.get(receipt.requester) ?? [];
    requesterIds.push(receipt.id);
    this.requesterIndex.set(receipt.requester, requesterIds);
  }

  /**
   * Add a receipt only if both signatures are valid.
   * Returns true if the receipt was accepted, false if signatures failed.
   */
  addVerifiedReceipt(receipt: WorkReceipt): boolean {
    if (!this.verifyReceipt(receipt)) {
      return false;
    }
    this.addReceipt(receipt);
    return true;
  }

  /** Verify both signatures on a WorkReceipt */
  verifyReceipt(receipt: WorkReceipt): boolean {
    try {
      const requesterPub = hexToPublicKey(publicKeyFromDID(receipt.requester));
      const workerPub = hexToPublicKey(publicKeyFromDID(receipt.worker));

      const requesterOk = verifyString(receipt.requesterSignature, receipt.id, requesterPub);
      const workerOk = verifyString(receipt.workerSignature, receipt.id, workerPub);

      return requesterOk && workerOk;
    } catch {
      return false;
    }
  }

  /** Get all receipts where a DID acted as worker */
  getWorkerReceipts(did: DID): WorkReceipt[] {
    const ids = this.workerIndex.get(did) ?? [];
    return ids.map((id) => this.receipts.get(id)!).filter(Boolean);
  }

  /** Get all receipts where a DID acted as requester */
  getRequesterReceipts(did: DID): WorkReceipt[] {
    const ids = this.requesterIndex.get(did) ?? [];
    return ids.map((id) => this.receipts.get(id)!).filter(Boolean);
  }

  /**
   * Compute a reputation profile for an agent.
   *
   * Aggregates all WorkReceipts where the agent was a worker.
   * The scoring is intentionally simple — marketplaces can implement
   * their own sophisticated algorithms on top of the receipt data.
   */
  getProfile(did: DID): ReputationProfile {
    const workerReceipts = this.getWorkerReceipts(did);
    const requesterReceipts = this.getRequesterReceipts(did);

    const accepted = workerReceipts.filter((r) => r.status === "accepted");
    const disputed = workerReceipts.filter((r) => r.status === "disputed");

    // Aggregate quality and timeliness scores
    const qualityScores = accepted
      .map((r) => r.qualityScore)
      .filter((s): s is number => s !== undefined);
    const timelinessScores = accepted
      .map((r) => r.timelinessScore)
      .filter((s): s is number => s !== undefined);

    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0;
    const avgTimeliness = timelinessScores.length > 0
      ? timelinessScores.reduce((a, b) => a + b, 0) / timelinessScores.length
      : 0;

    // Build domain scores
    const domainScores = new Map<string, DomainReputation>();
    for (const receipt of workerReceipts) {
      const existing = domainScores.get(receipt.taskDomain) ?? {
        domain: receipt.taskDomain,
        tasksCompleted: 0,
        tasksRejected: 0,
        avgQuality: 0,
        avgTimeliness: 0,
        receiptIds: [],
      };

      existing.receiptIds.push(receipt.id);

      if (receipt.status === "accepted" || receipt.status === "partial") {
        existing.tasksCompleted++;
      } else if (receipt.status === "rejected") {
        existing.tasksRejected++;
      }

      domainScores.set(receipt.taskDomain, existing);
    }

    // Compute per-domain averages
    for (const [domain, domRep] of domainScores) {
      const domReceipts = domRep.receiptIds
        .map((id) => this.receipts.get(id)!)
        .filter((r) => r.status === "accepted");

      const dq = domReceipts.map((r) => r.qualityScore).filter((s): s is number => s !== undefined);
      const dt = domReceipts.map((r) => r.timelinessScore).filter((s): s is number => s !== undefined);

      domRep.avgQuality = dq.length > 0 ? dq.reduce((a, b) => a + b, 0) / dq.length : 0;
      domRep.avgTimeliness = dt.length > 0 ? dt.reduce((a, b) => a + b, 0) / dt.length : 0;

      domainScores.set(domain, domRep);
    }

    return {
      agent: did,
      totalTasksCompleted: accepted.length,
      totalTasksPosted: requesterReceipts.length,
      acceptanceRate: workerReceipts.length > 0
        ? accepted.length / workerReceipts.length
        : 0,
      disputeRate: workerReceipts.length > 0
        ? disputed.length / workerReceipts.length
        : 0,
      avgQualityScore: avgQuality,
      avgTimelinessScore: avgTimeliness,
      domainScores,
      receiptCount: workerReceipts.length,
      lastUpdated: new Date().toISOString(),
    };
  }

  /** Get a specific receipt by ID */
  getReceipt(id: string): WorkReceipt | null {
    return this.receipts.get(id) ?? null;
  }

  /** Total number of stored receipts */
  get size(): number {
    return this.receipts.size;
  }
}
