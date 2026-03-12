/**
 * Task Dispatch Types — interfaces for coding task dispatch and resolution.
 */

/** A file to include as context or to be modified */
export interface TaskFile {
  path: string;       // relative path from project root
  content: string;    // file content (UTF-8)
}

/** A single coding task definition (from tasks.json or CLI) */
export interface TaskDefinition {
  objective: string;
  context?: {
    files?: string[];       // explicit relative paths
    include?: string[];     // glob patterns to include
    exclude?: string[];     // glob patterns to exclude
  };
  tags?: string[];
}

/** Tasks file format (tasks.json) */
export interface TasksFile {
  tasks: TaskDefinition[];
}

/** What the solver receives */
export interface CodingTask {
  objective: string;
  files: Map<string, string>;   // path → content
  tags: string[];
}

/** What the solver returns */
export interface CodingResult {
  files: Map<string, string>;   // path → new content
  summary: string;
}

/** Result of merging task output into a git branch */
export interface MergeResult {
  branch: string;
  filesWritten: string[];
  commitHash: string;
  diffCommand: string;
}

/** Dispatch result for a single task */
export interface DispatchResult {
  taskId: string;
  objective: string;
  status: "completed" | "failed" | "timeout";
  merge?: MergeResult;
  error?: string;
  workerDid?: string;
  durationMs: number;
}
