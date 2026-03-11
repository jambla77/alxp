/**
 * Claude Solver — calls Anthropic API via @anthropic-ai/sdk.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Only imported when --solver claude is used.
 */

import type { TaskSolver } from "./interface.js";
import type { CodingTask, CodingResult } from "../types.js";

export interface ClaudeSolverConfig {
  model: string;   // e.g., claude-sonnet-4-20250514
}

export class ClaudeSolver implements TaskSolver {
  readonly name: string;

  constructor(private config: ClaudeSolverConfig) {
    this.name = `claude:${config.model}`;
  }

  async solve(task: CodingTask): Promise<CodingResult> {
    // Dynamic import — only loads @anthropic-ai/sdk when actually used
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const filesContent = this.formatFiles(task.files);

    const systemPrompt = `You are a coding assistant. You will receive source files and an objective.
Return ONLY a JSON object with this exact structure:
{
  "files": { "path/to/file.ts": "full file content here", ... },
  "summary": "Brief description of changes made"
}

Return ALL files provided, with modifications applied per the objective.
Do not include any text outside the JSON object. Do not use markdown code fences.`;

    const userPrompt = `## Objective
${task.objective}

## Files
${filesContent}

Return the modified files as JSON.`;

    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return this.parseResponse(textBlock.text);
  }

  private formatFiles(files: Map<string, string>): string {
    const parts: string[] = [];
    for (const [path, content] of files) {
      parts.push(`### ${path}\n\`\`\`\n${content}\n\`\`\``);
    }
    return parts.join("\n\n");
  }

  private parseResponse(content: string): CodingResult {
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let parsed: { files: Record<string, string>; summary: string };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Failed to parse Claude response as JSON:\n${content.substring(0, 500)}`);
    }

    if (!parsed.files || typeof parsed.files !== "object") {
      throw new Error("Claude response missing 'files' object");
    }

    const files = new Map<string, string>();
    for (const [path, fileContent] of Object.entries(parsed.files)) {
      if (typeof fileContent === "string") {
        files.set(path, fileContent);
      }
    }

    return {
      files,
      summary: parsed.summary ?? "Changes applied",
    };
  }
}
