/**
 * Sub-delegation: a worker delegates part of a task to another agent.
 *
 * This is the "recursive" part of ALXP — task trees, not just flat
 * request-response. When a worker receives a task they can:
 *
 * 1. Decompose it into subtasks
 * 2. Delegate subtasks to specialized agents
 * 3. Collect results and compose the final output
 *
 * Sub-delegation respects the UCAN attenuation principle:
 * - The sub-delegate gets a UCAN derived from the worker's grant
 * - Permissions can only be reduced, never escalated
 * - The original requester's delegation policy controls max depth
 */

import { ulid } from "ulid";
import { signString } from "../identity/signing.js";
import { delegateUCAN, type UCANToken } from "../identity/ucan.js";
import type { DID } from "../types/index.js";
import type { TaskSpec } from "../types/task.js";
import type { KeyPair } from "../identity/signing.js";

/** A subtask derived from a parent task */
export interface SubTask {
  /** Subtask spec (a full TaskSpec with parentTaskId set) */
  spec: TaskSpec;
  /** UCAN token delegated to the sub-worker */
  delegation: UCANToken;
  /** Status of this subtask */
  status: "pending" | "delegated" | "completed" | "failed";
  /** Result data (once completed) */
  result?: string;
}

/** Options for decomposing a task into subtasks */
export interface DecomposeOptions {
  parentTaskId: string;
  parentContractId: string;
  worker: DID;
  workerKey: KeyPair;
  parentUCAN: UCANToken;
  delegationPolicy: { maxDepth: number; allowSubDelegation: boolean };
}

/**
 * Sub-delegation manager.
 *
 * Tracks subtasks created from a parent task and manages their lifecycle.
 * Ensures delegation policy is respected (max depth, approval requirements).
 */
export class SubDelegationManager {
  private subtasks = new Map<string, SubTask>();

  constructor(private readonly options: DecomposeOptions) {
    if (!options.delegationPolicy.allowSubDelegation) {
      throw new Error("Sub-delegation is not allowed by the task's delegation policy");
    }
  }

  /**
   * Create a subtask and delegate it to a sub-worker.
   *
   * The UCAN token is attenuated from the parent grant:
   * - Scoped to the new subtask's contract
   * - Expiration cannot exceed parent's
   * - Capabilities are narrowed to what the subtask needs
   */
  createSubTask(params: {
    objective: string;
    domain: string;
    subWorker: DID;
    expiration: Date;
    inputs?: { name: string; data: string; mimeType?: string }[];
  }): SubTask {
    const { objective, domain, subWorker, expiration, inputs = [] } = params;
    const subtaskId = ulid();

    // Delegate UCAN with attenuated capabilities
    const subUCAN = delegateUCAN(this.options.parentUCAN, {
      delegatorKey: this.options.workerKey,
      audience: subWorker,
      capabilities: [
        { with: `alxp://task/${subtaskId}`, can: "task/submit" },
        { with: `alxp://context/${subtaskId}`, can: "context/read" },
      ],
      expiration,
    });

    const spec: TaskSpec = {
      id: subtaskId,
      requester: this.options.worker,
      created: new Date().toISOString(),
      objective,
      domain,
      inputs: inputs.map((i) => ({
        name: i.name,
        mimeType: i.mimeType ?? "text/plain",
        data: i.data,
      })),
      expectedOutput: {
        mimeType: "text/plain",
        description: `Subtask output for: ${objective}`,
      },
      privacyClass: "confidential",
      delegationPolicy: {
        allowSubDelegation: false, // No further sub-delegation by default
        maxDepth: 0,
        requireApproval: true,
      },
      acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
      verificationMethod: "optimistic",
      tags: [domain],
      parentTaskId: this.options.parentTaskId,
      signature: signString(subtaskId, this.options.workerKey.privateKey),
    };

    const subtask: SubTask = {
      spec,
      delegation: subUCAN,
      status: "pending",
    };

    this.subtasks.set(subtaskId, subtask);
    return subtask;
  }

  /** Mark a subtask as delegated (sent to sub-worker) */
  markDelegated(subtaskId: string): void {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);
    subtask.status = "delegated";
  }

  /** Mark a subtask as completed with its result */
  markCompleted(subtaskId: string, result: string): void {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);
    subtask.status = "completed";
    subtask.result = result;
  }

  /** Mark a subtask as failed */
  markFailed(subtaskId: string): void {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);
    subtask.status = "failed";
  }

  /** Get all subtasks */
  getSubTasks(): SubTask[] {
    return [...this.subtasks.values()];
  }

  /** Get a specific subtask */
  getSubTask(subtaskId: string): SubTask | null {
    return this.subtasks.get(subtaskId) ?? null;
  }

  /** Check if all subtasks are completed */
  allCompleted(): boolean {
    if (this.subtasks.size === 0) return false;
    return [...this.subtasks.values()].every((s) => s.status === "completed");
  }

  /** Check if any subtask has failed */
  anyFailed(): boolean {
    return [...this.subtasks.values()].some((s) => s.status === "failed");
  }

  /** Get the collected results from all completed subtasks */
  collectResults(): Map<string, string> {
    const results = new Map<string, string>();
    for (const [id, subtask] of this.subtasks) {
      if (subtask.status === "completed" && subtask.result) {
        results.set(id, subtask.result);
      }
    }
    return results;
  }

  /** Number of subtasks */
  get size(): number {
    return this.subtasks.size;
  }
}
