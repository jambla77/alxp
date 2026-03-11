import { ulid } from "ulid";
import type { Price, TaskSpec, TaskContract, ResultBundle, Stake, Challenge, SpotCheckConfig } from "../types/index.js";
import { runAutomatedVerification } from "./automated.js";

/** Staking adapter interface */
export interface StakingAdapter {
  lockStake(contractId: string, staker: string, amount: Price): Promise<Stake>;
  releaseStake(stakeId: string): Promise<Stake>;
  slashStake(stakeId: string, recipient: string): Promise<Stake>;
  refundStake(stakeId: string): Promise<Stake>;
  getStake(stakeId: string): Promise<Stake | null>;
}

/** Pending acceptance record */
export interface PendingAcceptance {
  contractId: string;
  resultId: string;
  challengeDeadline: string;
  stakeId?: string;
  status: "pending" | "finalized" | "challenged";
}

/**
 * Mock staking adapter for testing.
 */
export class MockStakingAdapter implements StakingAdapter {
  balances = new Map<string, number>();
  stakes = new Map<string, Stake>();

  fund(did: string, amount: number): void {
    this.balances.set(did, (this.balances.get(did) ?? 0) + amount);
  }

  async lockStake(contractId: string, staker: string, amount: Price): Promise<Stake> {
    const balance = this.balances.get(staker) ?? 0;
    if (balance < amount.amount) {
      throw new Error("Insufficient balance for stake");
    }
    this.balances.set(staker, balance - amount.amount);

    const stake: Stake = {
      id: ulid(),
      contractId,
      staker,
      amount,
      status: "locked",
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      signature: "mock-stake-sig",
    };
    this.stakes.set(stake.id, stake);
    return stake;
  }

  async releaseStake(stakeId: string): Promise<Stake> {
    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error("Stake not found");
    if (stake.status !== "locked") throw new Error("Stake is not locked");

    this.balances.set(stake.staker, (this.balances.get(stake.staker) ?? 0) + stake.amount.amount);
    const updated = { ...stake, status: "released" as const };
    this.stakes.set(stakeId, updated);
    return updated;
  }

  async slashStake(stakeId: string, recipient: string): Promise<Stake> {
    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error("Stake not found");
    if (stake.status !== "locked") throw new Error("Stake is not locked");

    this.balances.set(recipient, (this.balances.get(recipient) ?? 0) + stake.amount.amount);
    const updated = { ...stake, status: "slashed" as const };
    this.stakes.set(stakeId, updated);
    return updated;
  }

  async refundStake(stakeId: string): Promise<Stake> {
    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error("Stake not found");
    if (stake.status !== "locked") throw new Error("Stake is not locked");

    this.balances.set(stake.staker, (this.balances.get(stake.staker) ?? 0) + stake.amount.amount);
    const updated = { ...stake, status: "refunded" as const };
    this.stakes.set(stakeId, updated);
    return updated;
  }

  async getStake(stakeId: string): Promise<Stake | null> {
    return this.stakes.get(stakeId) ?? null;
  }
}

/**
 * Parse an ISO 8601 duration to milliseconds.
 * Supports simple durations like PT24H, PT1H30M, PT5M, PT30S.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 86400000; // Default 24h
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Optimistic verification manager.
 *
 * When a result passes Tier 1 automated checks:
 * 1. Result is "optimistically accepted"
 * 2. Challenge window opens
 * 3. If no challenge within window → fully accepted, stake released
 * 4. If challenge raised → escalates to dispute
 * 5. Challenge upheld → worker's stake slashed, challenger rewarded
 * 6. Challenge rejected → challenger's stake slashed, worker rewarded
 */
export class OptimisticVerifier {
  private pendingAcceptances = new Map<string, PendingAcceptance>();
  private challenges = new Map<string, Challenge>();

  constructor(private stakingAdapter: StakingAdapter) {}

  /** Begin optimistic verification for a result */
  async beginOptimisticAcceptance(
    contract: TaskContract,
    result: ResultBundle,
    challengeWindowDuration: string,
  ): Promise<PendingAcceptance> {
    const durationMs = parseDuration(challengeWindowDuration);
    const challengeDeadline = new Date(Date.now() + durationMs).toISOString();

    const pending: PendingAcceptance = {
      contractId: contract.id,
      resultId: result.id,
      challengeDeadline,
      stakeId: contract.workerStake?.id,
      status: "pending",
    };
    this.pendingAcceptances.set(contract.id, pending);
    return pending;
  }

  /** Raise a challenge against a pending result */
  async raiseChallenge(
    contractId: string,
    resultId: string,
    challenger: string,
    reason: string,
    evidence: { description: string; data?: string }[],
    challengerStakeAmount: Price,
  ): Promise<Challenge> {
    const pending = this.pendingAcceptances.get(contractId);
    if (!pending) throw new Error("No pending acceptance for this contract");
    if (pending.status !== "pending") throw new Error("Acceptance is not pending");

    // Check challenge window
    if (new Date() > new Date(pending.challengeDeadline)) {
      throw new Error("Challenge window has closed");
    }

    // Lock challenger's stake
    const challengerStake = await this.stakingAdapter.lockStake(
      contractId,
      challenger,
      challengerStakeAmount,
    );

    const challenge: Challenge = {
      id: ulid(),
      contractId,
      resultId,
      challenger,
      reason,
      evidence,
      challengerStake: challengerStakeAmount,
      created: new Date().toISOString(),
      windowExpires: pending.challengeDeadline,
      status: "open",
      signature: "mock-challenge-sig",
    };

    this.challenges.set(challenge.id, challenge);
    pending.status = "challenged";
    this.pendingAcceptances.set(contractId, pending);

    // Store the challenger's stake ID on the challenge for resolution
    (challenge as Challenge & { _challengerStakeId?: string })._challengerStakeId = challengerStake.id;

    return challenge;
  }

  /** Finalize acceptance after challenge window closes without challenges */
  async finalizeAcceptance(contractId: string): Promise<{
    status: "finalized";
    stakeReleased: boolean;
  }> {
    const pending = this.pendingAcceptances.get(contractId);
    if (!pending) throw new Error("No pending acceptance for this contract");
    if (pending.status !== "pending") throw new Error("Acceptance is not pending");

    if (new Date() < new Date(pending.challengeDeadline)) {
      throw new Error("Challenge window has not closed yet");
    }

    let stakeReleased = false;
    if (pending.stakeId) {
      await this.stakingAdapter.releaseStake(pending.stakeId);
      stakeReleased = true;
    }

    pending.status = "finalized";
    this.pendingAcceptances.set(contractId, pending);

    return { status: "finalized", stakeReleased };
  }

  /** Resolve a challenge */
  async resolveChallenge(
    challengeId: string,
    outcome: "challenger-wins" | "worker-wins",
    reason: string,
    workerStakeId?: string,
  ): Promise<Challenge> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) throw new Error("Challenge not found");
    if (challenge.status !== "open" && challenge.status !== "reviewing") {
      throw new Error("Challenge is already resolved");
    }

    const challengerStakeId = (challenge as Challenge & { _challengerStakeId?: string })._challengerStakeId;

    if (outcome === "challenger-wins") {
      // Worker's stake slashed to challenger
      if (workerStakeId) {
        await this.stakingAdapter.slashStake(workerStakeId, challenge.challenger);
      }
      // Challenger's stake released
      if (challengerStakeId) {
        await this.stakingAdapter.releaseStake(challengerStakeId);
      }
    } else {
      // Challenger's stake slashed to worker (we need the worker DID)
      // For simplicity, slash to the contract — the worker can be resolved externally
      if (challengerStakeId) {
        await this.stakingAdapter.slashStake(challengerStakeId, "worker");
      }
      // Worker's stake released
      if (workerStakeId) {
        await this.stakingAdapter.releaseStake(workerStakeId);
      }
    }

    const resolved: Challenge = {
      ...challenge,
      status: outcome === "challenger-wins" ? "upheld" : "rejected",
      resolution: {
        outcome,
        reason,
        resolvedAt: new Date().toISOString(),
      },
    };
    this.challenges.set(challengeId, resolved);
    return resolved;
  }

  /** Determine if a result should be spot-checked */
  shouldSpotCheck(config: SpotCheckConfig): boolean {
    return Math.random() < config.probability;
  }

  /** Run a spot check on an accepted result */
  async runSpotCheck(
    contract: TaskContract,
    result: ResultBundle,
    taskSpec: TaskSpec,
    config: SpotCheckConfig,
  ): Promise<{
    passed: boolean;
    method: string;
    slashed: boolean;
    slashAmount?: Price;
  }> {
    let passed = true;

    if (config.method === "automated-rerun") {
      const rerunResult = await runAutomatedVerification(result, taskSpec);
      passed = rerunResult.passed;
    }
    // "consensus" and "human" methods would be handled externally

    let slashed = false;
    let slashAmount: Price | undefined;

    if (!passed && contract.workerStake) {
      slashAmount = {
        amount: contract.agreedPrice.amount * config.slashMultiplier,
        currency: contract.agreedPrice.currency,
        model: "fixed",
      };
      await this.stakingAdapter.slashStake(contract.workerStake.id, contract.requester);
      slashed = true;
    }

    return {
      passed,
      method: config.method,
      slashed,
      slashAmount,
    };
  }

  /** Get a pending acceptance */
  getPending(contractId: string): PendingAcceptance | undefined {
    return this.pendingAcceptances.get(contractId);
  }

  /** Get a challenge */
  getChallenge(challengeId: string): Challenge | undefined {
    return this.challenges.get(challengeId);
  }
}
