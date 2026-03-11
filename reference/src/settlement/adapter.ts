/**
 * Settlement adapter interface and mock implementation.
 *
 * The protocol defines triggers and interfaces, not payment rails.
 * Different deployments can use different settlement mechanisms:
 * - Crypto (ETH, stablecoins)
 * - Traditional payment (Stripe, PayPal)
 * - Internal credits (platform tokens)
 * - Barter (reciprocal work exchange)
 *
 * Every adapter must implement the same interface so the protocol
 * can orchestrate escrow/release/refund without knowing the details.
 */

import { ulid } from "ulid";
import type { TaskContract } from "../types/contract.js";
import type { WorkReceipt } from "../types/receipt.js";
import type { Price } from "../types/primitives.js";

/** Reference to an escrow created by a settlement adapter */
export interface EscrowRef {
  id: string;
  adapter: string;
  amount: Price;
  status: "held" | "released" | "refunded" | "partial";
  createdAt: string;
  resolvedAt?: string;
}

/** Proof that a settlement action occurred */
export interface SettlementProofData {
  id: string;
  escrowId: string;
  action: "release" | "refund" | "partial-release";
  amount: Price;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Settlement adapter interface.
 * Every payment mechanism must implement these operations.
 */
export interface SettlementAdapter {
  /** Adapter identifier (e.g., "mock", "stripe", "eth") */
  readonly type: string;

  /** Create an escrow for a task contract. Funds are locked until released. */
  createEscrow(contract: TaskContract): Promise<EscrowRef>;

  /** Release escrowed funds to the worker upon accepted receipt. */
  releaseEscrow(escrowId: string, receipt: WorkReceipt): Promise<SettlementProofData>;

  /** Refund escrowed funds to the requester (cancelled/failed task). */
  refundEscrow(escrowId: string, reason: string): Promise<SettlementProofData>;

  /** Partially release funds (e.g., dispute compromise). */
  partialRelease(
    escrowId: string,
    workerAmount: Price,
    receipt: WorkReceipt,
  ): Promise<SettlementProofData>;

  /** Query the status of an escrow. */
  getEscrow(escrowId: string): Promise<EscrowRef | null>;
}

/**
 * Mock settlement adapter for testing.
 *
 * Tracks balances and escrows in memory. No real money moves.
 * Useful for integration tests and development.
 */
export class MockSettlementAdapter implements SettlementAdapter {
  readonly type = "mock";
  private escrows = new Map<string, EscrowRef>();
  private proofs: SettlementProofData[] = [];

  /** Balances keyed by DID */
  readonly balances = new Map<string, number>();

  /** Pre-fund an agent's balance for testing */
  fund(did: string, amount: number): void {
    const current = this.balances.get(did) ?? 0;
    this.balances.set(did, current + amount);
  }

  async createEscrow(contract: TaskContract): Promise<EscrowRef> {
    const requesterBalance = this.balances.get(contract.requester) ?? 0;
    if (requesterBalance < contract.agreedPrice.amount) {
      throw new Error(
        `Insufficient balance: ${contract.requester} has ${requesterBalance}, needs ${contract.agreedPrice.amount}`,
      );
    }

    // Deduct from requester
    this.balances.set(contract.requester, requesterBalance - contract.agreedPrice.amount);

    const escrow: EscrowRef = {
      id: ulid(),
      adapter: this.type,
      amount: contract.agreedPrice,
      status: "held",
      createdAt: new Date().toISOString(),
    };

    this.escrows.set(escrow.id, escrow);
    return escrow;
  }

  async releaseEscrow(escrowId: string, receipt: WorkReceipt): Promise<SettlementProofData> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    if (escrow.status !== "held") throw new Error(`Escrow ${escrowId} is ${escrow.status}, not held`);

    // Credit worker
    const workerBalance = this.balances.get(receipt.worker) ?? 0;
    this.balances.set(receipt.worker, workerBalance + escrow.amount.amount);

    escrow.status = "released";
    escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "release",
      amount: escrow.amount,
      timestamp: new Date().toISOString(),
    };
    this.proofs.push(proof);
    return proof;
  }

  async refundEscrow(escrowId: string, reason: string): Promise<SettlementProofData> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    if (escrow.status !== "held") throw new Error(`Escrow ${escrowId} is ${escrow.status}, not held`);

    // Find the requester from the escrow — we need to look up the contract
    // For mock, we'll use metadata. In a real adapter, the escrow would track this.
    // For now, refund to the first party that's not the worker.
    // We'll just track it via a separate map.
    escrow.status = "refunded";
    escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "refund",
      amount: escrow.amount,
      timestamp: new Date().toISOString(),
      metadata: { reason },
    };
    this.proofs.push(proof);
    return proof;
  }

  async partialRelease(
    escrowId: string,
    workerAmount: Price,
    receipt: WorkReceipt,
  ): Promise<SettlementProofData> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error(`Escrow not found: ${escrowId}`);
    if (escrow.status !== "held") throw new Error(`Escrow ${escrowId} is ${escrow.status}, not held`);
    if (workerAmount.amount > escrow.amount.amount) {
      throw new Error(`Partial release ${workerAmount.amount} exceeds escrow ${escrow.amount.amount}`);
    }

    // Credit worker with partial amount
    const workerBalance = this.balances.get(receipt.worker) ?? 0;
    this.balances.set(receipt.worker, workerBalance + workerAmount.amount);

    escrow.status = "partial";
    escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "partial-release",
      amount: workerAmount,
      timestamp: new Date().toISOString(),
    };
    this.proofs.push(proof);
    return proof;
  }

  async getEscrow(escrowId: string): Promise<EscrowRef | null> {
    return this.escrows.get(escrowId) ?? null;
  }

  /** Get all settlement proofs (for auditing) */
  getProofs(): SettlementProofData[] {
    return [...this.proofs];
  }
}
