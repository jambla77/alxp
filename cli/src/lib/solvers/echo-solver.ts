/**
 * Echo Solver — returns inputs unchanged (for testing the pipeline).
 */

import type { TaskSolver } from "./interface.js";
import type { CodingTask, CodingResult } from "../types.js";

export class EchoSolver implements TaskSolver {
  readonly name = "echo";

  async solve(task: CodingTask): Promise<CodingResult> {
    return {
      files: new Map(task.files),
      summary: `Echo: returned ${task.files.size} file(s) unchanged`,
    };
  }
}
