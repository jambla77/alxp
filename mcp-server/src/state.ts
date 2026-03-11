/**
 * State Store — tracks outsourced tasks in memory with optional JSON persistence.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface TrackedOffer {
  offerId: string;
  workerDid: string;
  workerEndpoint: string;
  price: number;
  currency: string;
  confidence: number;
  estimatedDuration?: string;
}

export interface TrackedResult {
  contractId: string;
  outputs: Array<{ name: string; mimeType: string; data: string }>;
  provenance?: {
    agentDid: string;
    startedAt: string;
    completedAt: string;
  };
}

export type TaskStatus =
  | "searching"
  | "bidding"
  | "awarded"
  | "running"
  | "submitted"
  | "accepted"
  | "rejected"
  | "failed"
  | "timeout";

export interface TrackedTask {
  taskId: string;
  objective: string;
  domain: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;

  // Populated as lifecycle progresses
  offers: TrackedOffer[];
  awardedTo?: {
    workerDid: string;
    workerEndpoint: string;
    contractId: string;
  };
  result?: TrackedResult;
  qualityScore?: number;
  feedback?: string;
  error?: string;
}

function getStatePath(): string {
  const dataDir = process.env["ALXP_DATA_DIR"] ?? join(homedir(), ".alxp");
  return join(dataDir, "state.json");
}

export class StateStore {
  private tasks = new Map<string, TrackedTask>();

  /** Create a new tracked task */
  create(taskId: string, objective: string, domain: string): TrackedTask {
    const now = new Date().toISOString();
    const task: TrackedTask = {
      taskId,
      objective,
      domain,
      status: "searching",
      createdAt: now,
      updatedAt: now,
      offers: [],
    };
    this.tasks.set(taskId, task);
    this.persistAsync();
    return task;
  }

  /** Get a task by ID */
  get(taskId: string): TrackedTask | undefined {
    return this.tasks.get(taskId);
  }

  /** List all tasks, optionally filtered by status */
  list(status?: TaskStatus): TrackedTask[] {
    const all = [...this.tasks.values()];
    if (status) return all.filter((t) => t.status === status);
    return all;
  }

  /** Update a task */
  update(taskId: string, updates: Partial<TrackedTask>): TrackedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.persistAsync();
    return task;
  }

  /** Load state from disk */
  async load(): Promise<void> {
    try {
      const raw = await readFile(getStatePath(), "utf-8");
      const entries: [string, TrackedTask][] = JSON.parse(raw);
      this.tasks = new Map(entries);
    } catch {
      // No state file yet — start fresh
    }
  }

  /** Persist state to disk (fire and forget) */
  private persistAsync(): void {
    const entries = [...this.tasks.entries()];
    const statePath = getStatePath();
    const dataDir = process.env["ALXP_DATA_DIR"] ?? join(homedir(), ".alxp");
    mkdir(dataDir, { recursive: true })
      .then(() => writeFile(statePath, JSON.stringify(entries, null, 2), "utf-8"))
      .catch(() => {
        // Best-effort persistence
      });
  }

  get size(): number {
    return this.tasks.size;
  }
}
