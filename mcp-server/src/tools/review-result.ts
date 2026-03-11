/**
 * review_result — accept or reject a completed task's result.
 */

import type { ALXPBridge } from "../bridge.js";
import type { StateStore } from "../state.js";

export const definition = {
  name: "review_result",
  description:
    "Accept or reject the result of a completed task. " +
    "Accepting issues a WorkReceipt that builds the worker agent's reputation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task_id: {
        type: "string",
        description: "The task ID to review",
      },
      verdict: {
        type: "string",
        enum: ["accept", "reject"],
        description: "Accept or reject the delivered result",
      },
      quality_score: {
        type: "number",
        description: "Quality rating from 0 to 1 (default: 0.8). Only used when accepting.",
      },
      feedback: {
        type: "string",
        description: "Optional feedback for the worker agent",
      },
    },
    required: ["task_id", "verdict"],
  },
};

export async function handler(
  bridge: ALXPBridge,
  state: StateStore,
  args: Record<string, unknown>,
): Promise<string> {
  const taskId = args["task_id"] as string;
  const verdict = args["verdict"] as "accept" | "reject";
  const qualityScore = args["quality_score"] as number | undefined;
  const feedback = args["feedback"] as string | undefined;

  // Support partial ID matching
  let task = state.get(taskId);
  if (!task) {
    const all = state.list();
    task = all.find((t) => t.taskId.startsWith(taskId));
  }

  if (!task) {
    return `Task not found: ${taskId}`;
  }

  if (task.status !== "submitted") {
    return `Task ${taskId} is in status "${task.status}" — can only review tasks in "submitted" status.`;
  }

  try {
    if (verdict === "accept") {
      const updated = await bridge.acceptResult(task.taskId, qualityScore);
      if (!updated) return `Failed to accept result for task ${taskId}`;

      const lines = [
        `Result accepted for task ${task.taskId}`,
        `Quality score: ${qualityScore ?? 0.8}`,
        `WorkReceipt issued to ${task.awardedTo?.workerDid}`,
      ];
      if (feedback) lines.push(`Feedback: ${feedback}`);
      return lines.join("\n");
    } else {
      const updated = await bridge.rejectResult(task.taskId, feedback);
      if (!updated) return `Failed to reject result for task ${taskId}`;

      const lines = [
        `Result rejected for task ${task.taskId}`,
      ];
      if (feedback) lines.push(`Feedback sent: ${feedback}`);
      return lines.join("\n");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error reviewing result: ${message}`;
  }
}
