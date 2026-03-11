import type { TaskSpec, TaskContract, ResultBundle } from "../types/index.js";
import type { AutomatedVerificationResult } from "./automated.js";
import type { ConsensusResult } from "../types/consensus.js";
import { runAutomatedVerification } from "./automated.js";
import { OptimisticVerifier } from "./economic.js";
import { ConsensusVerifier } from "./consensus.js";
import { MerkleTreeBuilder } from "./merkle.js";

export interface VerificationResult {
  passed: boolean;
  decidingTier: "automated" | "economic" | "consensus" | "human";
  automatedResult: AutomatedVerificationResult;
  economicState?: {
    staked: boolean;
    challengeDeadline?: string;
    challenged: boolean;
  };
  consensusResult?: ConsensusResult;
  qualityScore: number;
}

/**
 * Unified verification engine.
 *
 * Routes verification through the appropriate tiers based on
 * the task's verificationMethod and acceptanceCriteria.
 */
export class VerificationEngine {
  constructor(
    private optimisticVerifier?: OptimisticVerifier,
    private consensusVerifier?: ConsensusVerifier,
  ) {}

  /**
   * Verify a result according to the task's verification requirements.
   *
   * Flow:
   * 1. ALWAYS run Tier 1 (automated checks). If automated criteria exist and fail → reject.
   * 2. Based on verificationMethod:
   *    - "automated": done, return Tier 1 result
   *    - "optimistic": Tier 1 passed → begin challenge window (Tier 2)
   *    - "consensus": Tier 1 passed → run consensus verification (Tier 3)
   *    - "proof": Tier 1 + verify merkle provenance tree integrity
   */
  async verify(
    taskSpec: TaskSpec,
    contract: TaskContract,
    result: ResultBundle,
  ): Promise<VerificationResult> {
    // Step 1: Always run automated checks
    const automatedResult = await runAutomatedVerification(result, taskSpec);

    // If there were automated criteria and they failed, reject immediately
    if (automatedResult.checks.length > 0 && !automatedResult.passed) {
      return {
        passed: false,
        decidingTier: "automated",
        automatedResult,
        qualityScore: automatedResult.score,
      };
    }

    // Step 2: Route based on verification method
    switch (taskSpec.verificationMethod) {
      case "automated":
        return {
          passed: automatedResult.passed,
          decidingTier: "automated",
          automatedResult,
          qualityScore: automatedResult.score,
        };

      case "optimistic":
        if (this.optimisticVerifier) {
          const pending = await this.optimisticVerifier.beginOptimisticAcceptance(
            contract,
            result,
            taskSpec.challengeWindow ?? "PT24H",
          );
          return {
            passed: true,
            decidingTier: "economic",
            automatedResult,
            economicState: {
              staked: !!contract.workerStake,
              challengeDeadline: pending.challengeDeadline,
              challenged: false,
            },
            qualityScore: automatedResult.score,
          };
        }
        return {
          passed: automatedResult.passed,
          decidingTier: "automated",
          automatedResult,
          qualityScore: automatedResult.score,
        };

      case "consensus":
        if (this.consensusVerifier) {
          const consensusCriteria = taskSpec.acceptanceCriteria.find(
            (c) => c.type === "consensus",
          );
          if (consensusCriteria && consensusCriteria.type === "consensus") {
            const consensusResult = await this.consensusVerifier.verify(
              taskSpec,
              contract,
              result,
              {
                count: consensusCriteria.validators,
                excludeParties: [contract.requester, contract.worker],
                requiredDomain: taskSpec.domain,
              },
            );
            return {
              passed: consensusResult.passed,
              decidingTier: "consensus",
              automatedResult,
              consensusResult,
              qualityScore: consensusResult.averageQuality,
            };
          }
        }
        return {
          passed: automatedResult.passed,
          decidingTier: "automated",
          automatedResult,
          qualityScore: automatedResult.score,
        };

      case "proof": {
        let provenanceValid = true;
        if (result.provenanceTree) {
          provenanceValid = MerkleTreeBuilder.verifyTree(result.provenanceTree);
        }
        return {
          passed: automatedResult.passed && provenanceValid,
          decidingTier: "automated",
          automatedResult,
          qualityScore: provenanceValid ? automatedResult.score : 0,
        };
      }

      default:
        return {
          passed: automatedResult.passed,
          decidingTier: "automated",
          automatedResult,
          qualityScore: automatedResult.score,
        };
    }
  }
}
