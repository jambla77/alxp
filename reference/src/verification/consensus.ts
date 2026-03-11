import { ulid } from "ulid";
import type {
  TaskSpec,
  TaskContract,
  ResultBundle,
  ValidatorAssessment,
  ConsensusResult,
  DID,
} from "../types/index.js";

/** Configuration for selecting validators */
export interface ValidatorSelectionConfig {
  count: number;
  minReputation?: number;
  requiredDomain?: string;
  excludeParties: DID[];
}

/** A validator agent that can assess work */
export interface ValidatorAgent {
  did: DID;
  domain: string;
  reputation: number;
  /** Called to assess a result — returns the assessment */
  assess(
    taskSpec: TaskSpec,
    result: ResultBundle,
  ): Promise<Pick<ValidatorAssessment, "accepted" | "qualityScore" | "reasoning">>;
}

/**
 * Consensus verification orchestrator.
 *
 * Sends the result to k independent validator agents.
 * Each validator independently assesses the work.
 * Result passes if >= threshold fraction of validators accept.
 *
 * Key design decisions:
 * - Validators don't see each other's assessments until all have submitted
 * - Validators who consistently agree with consensus build reputation
 * - Validators who consistently disagree lose reputation
 */
export class ConsensusVerifier {
  private validatorPool: ValidatorAgent[] = [];

  /** Register a validator agent in the pool */
  registerValidator(validator: ValidatorAgent): void {
    this.validatorPool.push(validator);
  }

  /** Get the current validator pool size */
  get poolSize(): number {
    return this.validatorPool.length;
  }

  /**
   * Run consensus verification on a result.
   *
   * 1. Select k validator agents from the pool
   * 2. Each validator independently assesses the result
   * 3. Collect assessments
   * 4. Compute consensus
   * 5. Return result
   */
  async verify(
    taskSpec: TaskSpec,
    contract: TaskContract,
    result: ResultBundle,
    selectionConfig: ValidatorSelectionConfig,
  ): Promise<ConsensusResult> {
    // 1. Select validators
    const validators = this.selectValidators(selectionConfig);

    if (validators.length === 0) {
      throw new Error("No validators available matching selection criteria");
    }

    // 2. Collect assessments from each validator
    const assessments: ValidatorAssessment[] = [];

    for (const validator of validators) {
      const assessment = await validator.assess(taskSpec, result);
      assessments.push({
        validator: validator.did,
        contractId: contract.id,
        resultId: result.id,
        accepted: assessment.accepted,
        qualityScore: assessment.qualityScore,
        reasoning: assessment.reasoning,
        assessedAt: new Date().toISOString(),
        signature: "mock-validator-sig",
      });
    }

    // 3. Find threshold from acceptance criteria
    const consensusCriteria = taskSpec.acceptanceCriteria.find(
      (c) => c.type === "consensus",
    );
    const threshold = consensusCriteria && consensusCriteria.type === "consensus"
      ? consensusCriteria.threshold
      : 0.5;

    // 4. Compute consensus
    const acceptedCount = assessments.filter((a) => a.accepted).length;
    const acceptanceRatio = assessments.length > 0
      ? acceptedCount / assessments.length
      : 0;
    const averageQuality = assessments.length > 0
      ? assessments.reduce((sum, a) => sum + a.qualityScore, 0) / assessments.length
      : 0;
    const passed = acceptanceRatio >= threshold;

    return {
      id: ulid(),
      contractId: contract.id,
      resultId: result.id,
      validators: validators.map((v) => v.did),
      assessments,
      threshold,
      acceptanceRatio,
      averageQuality,
      passed,
      completedAt: new Date().toISOString(),
    };
  }

  /** Select validators from the pool matching criteria */
  private selectValidators(config: ValidatorSelectionConfig): ValidatorAgent[] {
    let candidates = this.validatorPool.filter(
      (v) => !config.excludeParties.includes(v.did),
    );

    if (config.requiredDomain) {
      candidates = candidates.filter((v) => v.domain === config.requiredDomain);
    }

    if (config.minReputation !== undefined) {
      candidates = candidates.filter((v) => v.reputation >= config.minReputation!);
    }

    // Shuffle and take up to config.count
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, config.count);
  }
}
