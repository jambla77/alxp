/**
 * Solver Factory — creates the appropriate TaskSolver based on config.
 */

import type { TaskSolver } from "./solvers/interface.js";
import { EchoSolver } from "./solvers/echo-solver.js";

export interface SolverConfig {
  solver: "echo" | "openai" | "claude";
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string | null;
  anthropicModel: string;
}

export async function createSolver(config: SolverConfig): Promise<TaskSolver> {
  switch (config.solver) {
    case "echo":
      return new EchoSolver();

    case "openai": {
      const { OpenAISolver } = await import("./solvers/openai-solver.js");
      return new OpenAISolver({
        endpoint: config.llmEndpoint,
        model: config.llmModel,
        apiKey: config.llmApiKey,
      });
    }

    case "claude": {
      const { ClaudeSolver } = await import("./solvers/claude-solver.js");
      return new ClaudeSolver({
        model: config.anthropicModel,
      });
    }

    default:
      throw new Error(`Unknown solver: ${config.solver}`);
  }
}
