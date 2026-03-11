/**
 * TaskSolver Interface — abstraction over different code generation backends.
 */

import type { CodingTask, CodingResult } from "../types.js";

export interface TaskSolver {
  readonly name: string;
  solve(task: CodingTask): Promise<CodingResult>;
}
