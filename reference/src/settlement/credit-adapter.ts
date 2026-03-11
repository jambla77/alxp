/**
 * Credit Settlement Adapter — settles tasks using the credit ledger.
 *
 * Implements the standard SettlementAdapter interface, backed by a
 * CreditLedger. This means the full escrow/release/refund lifecycle
 * works with credits instead of real money.
 */

import { ulid } from "ulid";
import type { TaskContract } from "../types/contract.js";
import type { WorkReceipt } from "../types/receipt.js";
import type { Price } from "../types/primitives.js";
import type { SettlementAdapter, EscrowRef, SettlementProofData } from "./adapter.js";
import { CreditLedger } from "./credit-ledger.js";

/** Escrow metadata tracking requester/contract association */
interface CreditEscrowMeta {
  escrow: EscrowRef;
  requesterId: string;
  contractId: string;
  taskId: string;
}

/**
 * Settlement adapter backed by a credit ledger.
 *
 * All prices must use currency "credits". The adapter will reject
 * contracts with other currencies.
 */
export class CreditSettlementAdapter implements SettlementAdapter {
  readonly type = "credit-ledger";
  private escrows = new Map<string, CreditEscrowMeta>();
  private proofs: SettlementProofData[] = [];

  constructor(public readonly ledger: CreditLedger = new CreditLedger()) {}

  async createEscrow(contract: TaskContract): Promise<EscrowRef> {
    if (contract.agreedPrice.currency !== "credits") {
      throw new Error(
        `CreditSettlementAdapter only supports currency "credits", got "${contract.agreedPrice.currency}"`,
      );
    }

    // Escrow credits from the requester
    this.ledger.escrow(
      contract.requester,
      contract.agreedPrice.amount,
      contract.id,
      contract.taskId,
    );

    const escrow: EscrowRef = {
      id: ulid(),
      adapter: this.type,
      amount: contract.agreedPrice,
      status: "held",
      createdAt: new Date().toISOString(),
    };

    this.escrows.set(escrow.id, {
      escrow,
      requesterId: contract.requester,
      contractId: contract.id,
      taskId: contract.taskId,
    });

    return escrow;
  }

  async releaseEscrow(escrowId: string, receipt: WorkReceipt): Promise<SettlementProofData> {
    const meta = this.escrows.get(escrowId);
    if (!meta) throw new Error(`Escrow not found: ${escrowId}`);
    if (meta.escrow.status !== "held") {
      throw new Error(`Escrow ${escrowId} is ${meta.escrow.status}, not held`);
    }

    // Release full amount from requester escrow to worker
    this.ledger.release(
      meta.requesterId,
      receipt.worker,
      meta.escrow.amount.amount,
      meta.contractId,
      meta.taskId,
    );

    meta.escrow.status = "released";
    meta.escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "release",
      amount: meta.escrow.amount,
      timestamp: new Date().toISOString(),
      metadata: {
        requester: meta.requesterId,
        worker: receipt.worker,
      },
    };
    this.proofs.push(proof);
    return proof;
  }

  async refundEscrow(escrowId: string, reason: string): Promise<SettlementProofData> {
    const meta = this.escrows.get(escrowId);
    if (!meta) throw new Error(`Escrow not found: ${escrowId}`);
    if (meta.escrow.status !== "held") {
      throw new Error(`Escrow ${escrowId} is ${meta.escrow.status}, not held`);
    }

    // Refund escrowed credits back to the requester
    this.ledger.refund(
      meta.requesterId,
      meta.escrow.amount.amount,
      meta.contractId,
      meta.taskId,
    );

    meta.escrow.status = "refunded";
    meta.escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "refund",
      amount: meta.escrow.amount,
      timestamp: new Date().toISOString(),
      metadata: { reason, requester: meta.requesterId },
    };
    this.proofs.push(proof);
    return proof;
  }

  async partialRelease(
    escrowId: string,
    workerAmount: Price,
    receipt: WorkReceipt,
  ): Promise<SettlementProofData> {
    const meta = this.escrows.get(escrowId);
    if (!meta) throw new Error(`Escrow not found: ${escrowId}`);
    if (meta.escrow.status !== "held") {
      throw new Error(`Escrow ${escrowId} is ${meta.escrow.status}, not held`);
    }
    if (workerAmount.amount > meta.escrow.amount.amount) {
      throw new Error(
        `Partial release ${workerAmount.amount} exceeds escrow ${meta.escrow.amount.amount}`,
      );
    }

    const refundAmount = meta.escrow.amount.amount - workerAmount.amount;

    // Release partial amount to worker
    if (workerAmount.amount > 0) {
      this.ledger.release(
        meta.requesterId,
        receipt.worker,
        workerAmount.amount,
        meta.contractId,
        meta.taskId,
      );
    }

    // Refund remainder to requester
    if (refundAmount > 0) {
      this.ledger.refund(
        meta.requesterId,
        refundAmount,
        meta.contractId,
        meta.taskId,
      );
    }

    meta.escrow.status = "partial";
    meta.escrow.resolvedAt = new Date().toISOString();

    const proof: SettlementProofData = {
      id: ulid(),
      escrowId,
      action: "partial-release",
      amount: workerAmount,
      timestamp: new Date().toISOString(),
      metadata: {
        requester: meta.requesterId,
        worker: receipt.worker,
        refundedAmount: refundAmount,
      },
    };
    this.proofs.push(proof);
    return proof;
  }

  async getEscrow(escrowId: string): Promise<EscrowRef | null> {
    return this.escrows.get(escrowId)?.escrow ?? null;
  }

  /** Get all settlement proofs for auditing */
  getProofs(): SettlementProofData[] {
    return [...this.proofs];
  }
}
