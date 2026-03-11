/**
 * check_status — get detailed status of a specific outsourced task.
 */

import type { StateStore } from "../state.js";

export const definition = {
  name: "check_status",
  description:
    "Check the detailed status of a specific outsourced task, including worker info, bids, and result if available.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task_id: {
        type: "string",
        description: "The task ID (returned by outsource_task or list_tasks)",
      },
    },
    required: ["task_id"],
  },
};

export function handler(
  state: StateStore,
  args: Record<string, unknown>,
): string {
  const taskId = args["task_id"] as string;

  // Support partial ID matching
  let task = state.get(taskId);
  if (!task) {
    const all = state.list();
    task = all.find((t) => t.taskId.startsWith(taskId));
  }

  if (!task) {
    return `Task not found: ${taskId}`;
  }

  const lines: string[] = [
    `Task: ${task.taskId}`,
    `Objective: ${task.objective}`,
    `Domain: ${task.domain}`,
    `Status: ${task.status}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`,
  ];

  if (task.offers.length > 0) {
    lines.push("");
    lines.push(`Bids (${task.offers.length}):`);
    for (const offer of task.offers) {
      lines.push(`  - ${offer.workerDid.slice(0, 30)}... — $${offer.price} ${offer.currency} (confidence: ${offer.confidence})`);
    }
  }

  if (task.awardedTo) {
    lines.push("");
    lines.push(`Awarded to: ${task.awardedTo.workerDid}`);
    lines.push(`Contract: ${task.awardedTo.contractId}`);
    lines.push(`Worker endpoint: ${task.awardedTo.workerEndpoint}`);
  }

  if (task.result) {
    lines.push("");
    lines.push("--- Result ---");
    for (const output of task.result.outputs) {
      lines.push(`[${output.name}] (${output.mimeType}):`);
      // Truncate very long outputs
      const data = output.data.length > 2000
        ? output.data.slice(0, 2000) + "\n... (truncated)"
        : output.data;
      lines.push(data);
    }
  }

  if (task.qualityScore !== undefined) {
    lines.push(`Quality score: ${task.qualityScore}`);
  }

  if (task.feedback) {
    lines.push(`Feedback: ${task.feedback}`);
  }

  if (task.error) {
    lines.push(`Error: ${task.error}`);
  }

  return lines.join("\n");
}
