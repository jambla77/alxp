/**
 * Task Board — pull-based task discovery for ALXP.
 *
 * Requesters post signed tasks to the board. Workers browse and query
 * for tasks matching their capabilities, then bid peer-to-peer via
 * the task's replyEndpoint. The board is a relay/matchmaker (like DNS),
 * not a platform — tasks expire, agents can post to multiple registries.
 */

import type { TaskSpec, DID } from "../types/index.js";
import type { CapabilityDescription as CapabilityDescriptionType } from "../types/index.js";
import { publicKeyFromDID } from "../identity/did.js";
import { hexToPublicKey, verifyString } from "../identity/signing.js";

/** A task posted to the board, with relay metadata */
export interface PostedTask {
  taskSpec: TaskSpec;
  replyEndpoint: string;
  postedAt: string;
  expiresAt: string;
}

/** Worker's search criteria for browsing the board */
export interface TaskQuery {
  domain?: string;
  tags?: string[];
  maxBudget?: number;
  budgetCurrency?: string;
  requester?: DID;
  limit?: number;
}

/** Options for configuring the TaskBoard */
export interface TaskBoardOptions {
  /** Default time-to-live for posted tasks in ms. Default: 3600000 (1hr) */
  defaultTTL?: number;
  /** How often to sweep expired tasks in ms. Default: 30000 (30s) */
  sweepInterval?: number;
  /** Maximum number of tasks on the board. Default: 10000 */
  maxTasks?: number;
}

/**
 * Verify a task spec's signature.
 * The signature covers the task ID, signed by the requester's private key.
 */
export function verifyTaskSignature(taskSpec: TaskSpec): boolean {
  try {
    const pubHex = publicKeyFromDID(taskSpec.requester as DID);
    const publicKey = hexToPublicKey(pubHex);
    return verifyString(taskSpec.signature, taskSpec.id, publicKey);
  } catch {
    return false;
  }
}

/**
 * TaskBoard — stores announced tasks and lets workers query for matching work.
 *
 * Follows the same patterns as AgentRegistry (in-memory, sweepable)
 * and HeartbeatTracker (periodic cleanup).
 */
export class TaskBoard {
  private tasks = new Map<string, PostedTask>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  readonly defaultTTL: number;
  readonly sweepInterval: number;
  readonly maxTasks: number;

  constructor(options: TaskBoardOptions = {}) {
    this.defaultTTL = options.defaultTTL ?? 3_600_000;
    this.sweepInterval = options.sweepInterval ?? 30_000;
    this.maxTasks = options.maxTasks ?? 10_000;
  }

  /** Post a task to the board. Returns the posted task with relay metadata. */
  post(taskSpec: TaskSpec, replyEndpoint: string): PostedTask {
    if (this.tasks.size >= this.maxTasks) {
      throw new Error(`Task board is full (max ${this.maxTasks} tasks)`);
    }

    const now = new Date();
    const expiresAt = taskSpec.expires
      ? taskSpec.expires
      : new Date(now.getTime() + this.defaultTTL).toISOString();

    const posted: PostedTask = {
      taskSpec,
      replyEndpoint,
      postedAt: now.toISOString(),
      expiresAt,
    };

    this.tasks.set(taskSpec.id, posted);
    return posted;
  }

  /** Remove a task from the board (awarded or cancelled). */
  remove(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  /** Get a specific posted task. */
  get(taskId: string): PostedTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  /** Query tasks by domain, tags, budget, and requester. */
  query(query: TaskQuery): PostedTask[] {
    const now = new Date();
    let results: PostedTask[] = [];

    for (const posted of this.tasks.values()) {
      if (new Date(posted.expiresAt) <= now) continue;

      const spec = posted.taskSpec;

      if (query.domain && spec.domain !== query.domain) continue;

      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some((t) => spec.tags.includes(t))) continue;
      }

      if (query.maxBudget !== undefined && spec.budget) {
        const currency = query.budgetCurrency ?? "USD";
        if (spec.budget.currency === currency && spec.budget.maxAmount > query.maxBudget) continue;
      }

      if (query.requester && spec.requester !== query.requester) continue;

      results.push(posted);
    }

    if (query.limit && results.length > query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Find tasks matching a worker's capabilities.
   * Inverse of matchesQuery — given a worker's capabilities, find tasks they could handle.
   */
  matchForWorker(capabilities: CapabilityDescriptionType[]): PostedTask[] {
    const now = new Date();
    const results: PostedTask[] = [];

    for (const posted of this.tasks.values()) {
      if (new Date(posted.expiresAt) <= now) continue;

      const spec = posted.taskSpec;

      // Check if any of the worker's capabilities match the task's domain and tags
      const matches = capabilities.some((cap) => {
        if (cap.domain !== spec.domain) return false;

        // If the task has tags, at least one must overlap with the capability's tags
        if (spec.tags.length > 0 && cap.tags.length > 0) {
          if (!spec.tags.some((t) => cap.tags.includes(t))) return false;
        }

        return true;
      });

      if (matches) {
        results.push(posted);
      }
    }

    return results;
  }

  /** Remove expired tasks. Returns the IDs of removed tasks. */
  sweep(): string[] {
    const now = new Date();
    const expired: string[] = [];

    for (const [id, posted] of this.tasks) {
      if (new Date(posted.expiresAt) <= now) {
        expired.push(id);
        this.tasks.delete(id);
      }
    }

    return expired;
  }

  /** Start automatic periodic sweeps */
  startSweeping(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepInterval);
  }

  /** Stop automatic periodic sweeps */
  stopSweeping(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** List all non-expired tasks */
  list(): PostedTask[] {
    const now = new Date();
    return [...this.tasks.values()].filter(
      (posted) => new Date(posted.expiresAt) > now,
    );
  }

  /** Number of tasks currently on the board (including expired, until swept) */
  get size(): number {
    return this.tasks.size;
  }
}
