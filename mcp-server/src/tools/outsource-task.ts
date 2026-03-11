/**
 * outsource_task — post a task, find agents, get bids, award, and wait for result.
 */

import type { ALXPBridge } from "../bridge.js";

export const definition = {
  name: "outsource_task",
  description:
    "Outsource a task to a remote AI agent via the ALXP protocol. " +
    "Finds matching agents, collects bids, awards the best one, and waits for the completed result.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objective: {
        type: "string",
        description: "Clear description of what you want done",
      },
      domain: {
        type: "string",
        description: "The domain of work (e.g., 'coding', 'summarization', 'translation', 'code-review'). Default: 'coding'",
      },
      context: {
        type: "string",
        description: "Any context, instructions, or data the agent needs to complete the task",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "File name or path" },
            content: { type: "string", description: "File content" },
          },
          required: ["name", "content"],
        },
        description: "Files to send as input to the worker agent",
      },
      budget_max: {
        type: "number",
        description: "Maximum budget in USD",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags to help match the right agent (e.g., ['typescript', 'react'])",
      },
      timeout_seconds: {
        type: "number",
        description: "How long to wait for completion in seconds (default: 120)",
      },
    },
    required: ["objective"],
  },
};

export async function handler(
  bridge: ALXPBridge,
  args: Record<string, unknown>,
): Promise<string> {
  const objective = args["objective"] as string;
  const domain = (args["domain"] as string) ?? "coding";
  const context = args["context"] as string | undefined;
  const files = args["files"] as Array<{ name: string; content: string }> | undefined;
  const budgetMax = args["budget_max"] as number | undefined;
  const tags = args["tags"] as string[] | undefined;
  const timeoutSeconds = args["timeout_seconds"] as number | undefined;

  // Build inputs from context and files
  const inputs: Array<{ name: string; data: string; mimeType?: string }> = [];

  if (context) {
    inputs.push({ name: "context", data: context, mimeType: "text/plain" });
  }

  if (files) {
    for (const f of files) {
      inputs.push({ name: f.name, data: f.content, mimeType: "text/plain" });
    }
  }

  try {
    const task = await bridge.outsourceTask({
      objective,
      domain,
      inputs,
      budgetMax,
      budgetCurrency: "USD",
      tags,
      timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });

    // Format the response based on status
    const lines: string[] = [
      `Task ID: ${task.taskId}`,
      `Status: ${task.status}`,
      `Objective: ${task.objective}`,
    ];

    if (task.offers.length > 0) {
      lines.push(`Bids received: ${task.offers.length}`);
    }

    if (task.awardedTo) {
      lines.push(`Awarded to: ${task.awardedTo.workerDid}`);
      lines.push(`Contract: ${task.awardedTo.contractId}`);
    }

    if (task.result) {
      lines.push("");
      lines.push("--- Result ---");
      for (const output of task.result.outputs) {
        lines.push(`[${output.name}]:`);
        lines.push(output.data);
      }
    }

    if (task.error) {
      lines.push(`Error: ${task.error}`);
    }

    if (task.status === "timeout") {
      lines.push("");
      lines.push("The task is still in progress. Use check_status to poll for updates.");
    }

    return lines.join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error outsourcing task: ${message}`;
  }
}
