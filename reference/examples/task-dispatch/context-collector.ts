/**
 * Context Collector — reads project files into TaskInput[] for dispatch.
 *
 * Supports three modes:
 * - Explicit file paths
 * - Glob patterns (include/exclude)
 * - Auto-detect via git ls-files (default)
 */

import { readFile } from "fs/promises";
import { execSync } from "child_process";
import { join, relative } from "path";
import type { TaskDefinition, TaskFile } from "./types.js";

/** Code file extensions for auto-detect mode */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".swift", ".m", ".mm",
  ".vue", ".svelte", ".astro",
  ".html", ".css", ".scss", ".less",
  ".json", ".yaml", ".yml", ".toml",
  ".sql", ".graphql", ".gql",
  ".sh", ".bash", ".zsh",
  ".md", ".mdx",
]);

/** Max total bytes to collect in auto-detect mode */
const AUTO_DETECT_BUDGET = 500 * 1024; // 500KB

/**
 * Collect project files for a task definition.
 * Returns TaskFile[] with relative paths and content.
 */
export async function collectContext(
  projectRoot: string,
  task: TaskDefinition,
): Promise<TaskFile[]> {
  let paths: string[];

  if (task.context?.files && task.context.files.length > 0) {
    // Mode 1: Explicit file paths
    paths = task.context.files;
  } else if (task.context?.include && task.context.include.length > 0) {
    // Mode 2: Glob patterns
    paths = await globFiles(projectRoot, task.context.include, task.context.exclude ?? []);
  } else {
    // Mode 3: Auto-detect via git ls-files
    paths = await autoDetectFiles(projectRoot);
  }

  // Read file contents
  const files: TaskFile[] = [];
  let totalBytes = 0;

  for (const relPath of paths) {
    const absPath = join(projectRoot, relPath);
    try {
      const content = await readFile(absPath, "utf-8");
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > AUTO_DETECT_BUDGET * 2) {
        console.warn(`  Warning: context budget exceeded at ${relPath}, stopping collection`);
        break;
      }
      files.push({ path: relPath, content });
    } catch {
      console.warn(`  Warning: could not read ${relPath}, skipping`);
    }
  }

  return files;
}

/** Use git ls-files to find tracked code files within budget */
async function autoDetectFiles(projectRoot: string): Promise<string[]> {
  let allFiles: string[];
  try {
    const output = execSync("git ls-files", {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    allFiles = output.trim().split("\n").filter(Boolean);
  } catch {
    throw new Error(`Failed to run 'git ls-files' in ${projectRoot}. Is it a git repo?`);
  }

  // Filter to code extensions
  const codeFiles = allFiles.filter((f) => {
    const ext = f.substring(f.lastIndexOf("."));
    return CODE_EXTENSIONS.has(ext);
  });

  // Budget: read files until we hit the limit
  const selected: string[] = [];
  let totalBytes = 0;

  for (const f of codeFiles) {
    const absPath = join(projectRoot, f);
    try {
      const stat = execSync(`wc -c < "${absPath}"`, { encoding: "utf-8" });
      const size = parseInt(stat.trim(), 10);
      if (totalBytes + size > AUTO_DETECT_BUDGET) break;
      totalBytes += size;
      selected.push(f);
    } catch {
      // Skip unreadable files
    }
  }

  return selected;
}

/** Resolve glob patterns to file paths using git ls-files + filtering */
async function globFiles(
  projectRoot: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  let allFiles: string[];
  try {
    const output = execSync("git ls-files", {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    allFiles = output.trim().split("\n").filter(Boolean);
  } catch {
    throw new Error(`Failed to run 'git ls-files' in ${projectRoot}. Is it a git repo?`);
  }

  // Simple glob matching (supports * and **)
  const matchGlob = (file: string, pattern: string): boolean => {
    const regex = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "<<GLOBSTAR>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<GLOBSTAR>>/g, ".*");
    return new RegExp(`^${regex}$`).test(file);
  };

  return allFiles.filter((f) => {
    const included = include.some((p) => matchGlob(f, p));
    const excluded = exclude.some((p) => matchGlob(f, p));
    return included && !excluded;
  });
}
