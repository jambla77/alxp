/**
 * Credit Ledger — in-memory credit balance tracking with transaction history.
 *
 * Tracks credit balances per agent (by DID) and records every credit
 * movement as a CreditTransaction. Designed to be used by the
 * CreditSettlementAdapter but also useful standalone.
 */

import { ulid } from "ulid";
import type { DID } from "../types/primitives.js";
import type {
  CreditBalance,
  CreditTransaction,
  CreditTransactionType,
} from "../types/exchange.js";

/** Options for recording a credit transaction */
export interface TransactionOptions {
  type: CreditTransactionType;
  amount: number;
  relatedTaskId?: string;
  relatedContractId?: string;
  counterparty?: string;
  description?: string;
}

/**
 * In-memory credit ledger.
 *
 * Every balance mutation goes through a transaction, so the full
 * history is always available for auditing.
 */
export class CreditLedger {
  private balances = new Map<
    string,
    { available: number; escrowed: number; earned: number; spent: number; bootstrapped: number; donated: number; consumed: number }
  >();
  private transactions: CreditTransaction[] = [];

  /** Get or initialize a balance record for an agent */
  private getOrCreate(agentId: string) {
    let bal = this.balances.get(agentId);
    if (!bal) {
      bal = { available: 0, escrowed: 0, earned: 0, spent: 0, bootstrapped: 0, donated: 0, consumed: 0 };
      this.balances.set(agentId, bal);
    }
    return bal;
  }

  /** Record a transaction and return it */
  private record(agentId: string, opts: TransactionOptions): CreditTransaction {
    const bal = this.getOrCreate(agentId);
    const tx: CreditTransaction = {
      id: ulid(),
      agentId: agentId as DID,
      type: opts.type,
      amount: opts.amount,
      balance: bal.available,
      relatedTaskId: opts.relatedTaskId,
      relatedContractId: opts.relatedContractId,
      counterparty: opts.counterparty,
      description: opts.description,
      timestamp: new Date().toISOString(),
      signature: `ledger:${ulid()}`,
    };
    this.transactions.push(tx);
    return tx;
  }

  /**
   * Add bootstrap credits to an agent's balance.
   * Used to seed initial balance (e.g. sign-up bonus, initial grant).
   */
  bootstrap(agentId: string, amount: number, description?: string): CreditTransaction {
    if (amount <= 0) throw new Error("Bootstrap amount must be positive");
    const bal = this.getOrCreate(agentId);
    bal.available += amount;
    bal.bootstrapped += amount;
    return this.record(agentId, { type: "bootstrap", amount, description });
  }

  /**
   * @deprecated Use bootstrap() instead
   */
  purchase(agentId: string, amount: number, description?: string): CreditTransaction {
    return this.bootstrap(agentId, amount, description);
  }

  /**
   * Record a capacity donation — agent shares unused subscription capacity.
   * Credits the donor with the specified amount.
   */
  donate(agentId: string, amount: number, description?: string): CreditTransaction {
    if (amount <= 0) throw new Error("Donation amount must be positive");
    const bal = this.getOrCreate(agentId);
    bal.available += amount;
    bal.donated += amount;
    return this.record(agentId, { type: "donate", amount, description });
  }

  /**
   * Grant credits to an agent (bonus, referral, pool share, etc.).
   */
  grant(agentId: string, amount: number, description?: string): CreditTransaction {
    if (amount <= 0) throw new Error("Grant amount must be positive");
    const bal = this.getOrCreate(agentId);
    bal.available += amount;
    return this.record(agentId, { type: "grant", amount, description });
  }

  /**
   * Move credits from available to escrowed (when a task is awarded).
   * Returns the escrow transaction.
   */
  escrow(
    agentId: string,
    amount: number,
    contractId?: string,
    taskId?: string,
  ): CreditTransaction {
    if (amount <= 0) throw new Error("Escrow amount must be positive");
    const bal = this.getOrCreate(agentId);
    if (bal.available < amount) {
      throw new Error(
        `Insufficient credits: ${agentId} has ${bal.available}, needs ${amount}`,
      );
    }
    bal.available -= amount;
    bal.escrowed += amount;
    return this.record(agentId, {
      type: "escrow",
      amount,
      relatedContractId: contractId,
      relatedTaskId: taskId,
    });
  }

  /**
   * Release escrowed credits to a worker (task accepted).
   * Deducts from requester's escrowed, adds to worker's available + earned.
   */
  release(
    requesterId: string,
    workerId: string,
    amount: number,
    contractId?: string,
    taskId?: string,
  ): { requesterTx: CreditTransaction; workerTx: CreditTransaction } {
    if (amount <= 0) throw new Error("Release amount must be positive");
    const reqBal = this.getOrCreate(requesterId);
    if (reqBal.escrowed < amount) {
      throw new Error(
        `Insufficient escrowed credits: ${requesterId} has ${reqBal.escrowed} escrowed, needs ${amount}`,
      );
    }

    // Deduct from requester escrow, count as spent
    reqBal.escrowed -= amount;
    reqBal.spent += amount;
    const requesterTx = this.record(requesterId, {
      type: "release",
      amount: -amount,
      counterparty: workerId,
      relatedContractId: contractId,
      relatedTaskId: taskId,
    });

    // Credit worker
    const workerBal = this.getOrCreate(workerId);
    workerBal.available += amount;
    workerBal.earned += amount;
    const workerTx = this.record(workerId, {
      type: "earn",
      amount,
      counterparty: requesterId,
      relatedContractId: contractId,
      relatedTaskId: taskId,
    });

    return { requesterTx, workerTx };
  }

  /**
   * Refund escrowed credits back to the requester (task cancelled/failed).
   */
  refund(
    agentId: string,
    amount: number,
    contractId?: string,
    taskId?: string,
  ): CreditTransaction {
    if (amount <= 0) throw new Error("Refund amount must be positive");
    const bal = this.getOrCreate(agentId);
    if (bal.escrowed < amount) {
      throw new Error(
        `Insufficient escrowed credits: ${agentId} has ${bal.escrowed} escrowed, needs ${amount}`,
      );
    }
    bal.escrowed -= amount;
    bal.available += amount;
    return this.record(agentId, {
      type: "refund",
      amount,
      relatedContractId: contractId,
      relatedTaskId: taskId,
    });
  }

  /**
   * Slash credits from an agent (penalty for bad behavior).
   * Deducts from available balance. Can go to zero but not negative.
   */
  slash(agentId: string, amount: number, description?: string): CreditTransaction {
    if (amount <= 0) throw new Error("Slash amount must be positive");
    const bal = this.getOrCreate(agentId);
    const actual = Math.min(amount, bal.available);
    bal.available -= actual;
    return this.record(agentId, { type: "slash", amount: -actual, description });
  }

  /**
   * Get the current credit balance for an agent.
   */
  getBalance(agentId: string): CreditBalance {
    const bal = this.getOrCreate(agentId);
    return {
      agentId: agentId as DID,
      available: bal.available,
      escrowed: bal.escrowed,
      earned: bal.earned,
      spent: bal.spent,
      bootstrapped: bal.bootstrapped,
      donated: bal.donated,
      consumed: bal.consumed,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get all transactions for an agent, optionally filtered.
   */
  getTransactions(agentId?: string, type?: CreditTransactionType): CreditTransaction[] {
    let txs = this.transactions;
    if (agentId) txs = txs.filter((t) => t.agentId === agentId);
    if (type) txs = txs.filter((t) => t.type === type);
    return [...txs];
  }

  /**
   * Get total number of transactions recorded.
   */
  get transactionCount(): number {
    return this.transactions.length;
  }
}
