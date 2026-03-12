/**
 * OpenAI-compatible Solver — calls /v1/chat/completions endpoints.
 *
 * Works with Ollama, OpenAI, vLLM, LM Studio, or any OpenAI-compatible API.
 */

import type { TaskSolver } from "./interface.js";
import type { CodingTask, CodingResult } from "../types.js";

export interface OpenAISolverConfig {
  endpoint: string;
  model: string;
  apiKey?: string | null;
}

export class OpenAISolver implements TaskSolver {
  readonly name: string;

  constructor(private config: OpenAISolverConfig) {
    this.name = `openai:${config.model}`;
  }

  async solve(task: CodingTask): Promise<CodingResult> {
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }

    return this.parseResponse(content);
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
      throw new Error(`Failed to parse LLM response as JSON:\n${content.substring(0, 500)}`);
    }

    if (!parsed.files || typeof parsed.files !== "object") {
      throw new Error("LLM response missing 'files' object");
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
