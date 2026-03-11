/**
 * list_tasks — list all outsourced tasks with their current status.
 */

import type { StateStore, TaskStatus } from "../state.js";

export const definition = {
  name: "list_tasks",
  description:
    "List all tasks you've outsourced via the ALXP protocol, with their current status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        description: "Filter by status: searching, bidding, awarded, running, submitted, accepted, rejected, failed, timeout",
        enum: ["searching", "bidding", "awarded", "running", "submitted", "accepted", "rejected", "failed", "timeout"],
      },
    },
  },
};

export function handler(
  state: StateStore,
  args: Record<string, unknown>,
): string {
  const status = args["status"] as TaskStatus | undefined;
  const tasks = state.list(status);

  if (tasks.length === 0) {
    return status
      ? `No tasks with status "${status}".`
      : "No outsourced tasks yet.";
  }

  const lines = tasks.map((t) => {
    const age = timeSince(t.createdAt);
    const worker = t.awardedTo ? ` -> ${t.awardedTo.workerDid.slice(0, 20)}...` : "";
    return `  ${t.taskId.slice(0, 10)}  ${padRight(t.status, 10)}  ${age}  ${t.objective.slice(0, 50)}${worker}`;
  });

  const header = `  ${"ID".padEnd(10)}  ${"STATUS".padEnd(10)}  ${"AGE".padEnd(6)}  OBJECTIVE`;
  return `${tasks.length} task(s):\n\n${header}\n${lines.join("\n")}`;
}

function padRight(s: string, n: number): string {
  return s.padEnd(n);
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
