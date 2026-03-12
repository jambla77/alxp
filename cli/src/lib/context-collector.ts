/**
 * Context Collector — reads project files into TaskFile[] for dispatch.
 */

import { readFile } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import type { TaskDefinition, TaskFile } from "./types.js";

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

const AUTO_DETECT_BUDGET = 500 * 1024; // 500KB

export async function collectContext(
  projectRoot: string,
  task: TaskDefinition,
): Promise<TaskFile[]> {
  let paths: string[];

  if (task.context?.files && task.context.files.length > 0) {
    paths = task.context.files;
  } else if (task.context?.include && task.context.include.length > 0) {
    paths = await globFiles(projectRoot, task.context.include, task.context.exclude ?? []);
  } else {
    paths = await autoDetectFiles(projectRoot);
  }

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

  const codeFiles = allFiles.filter((f) => {
    const ext = f.substring(f.lastIndexOf("."));
    return CODE_EXTENSIONS.has(ext);
  });

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
