/**
 * Result Merger — writes task outputs to a git branch and commits.
 */

import { execSync } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve, relative } from "path";
import type { MergeResult } from "./types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40);
}

function git(projectRoot: string, cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: projectRoot,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

export async function mergeResult(
  projectRoot: string,
  taskId: string,
  objective: string,
  files: Map<string, string>,
  workerDid?: string,
): Promise<MergeResult> {
  const status = git(projectRoot, "status --porcelain");
  if (status.length > 0) {
    throw new Error(
      "Working tree has uncommitted changes. Commit or stash before merging ALXP results.\n" +
      `  git status:\n${status}`,
    );
  }

  const originalBranch = git(projectRoot, "rev-parse --abbrev-ref HEAD");

  const slug = slugify(objective);
  const shortId = taskId.substring(0, 8).toLowerCase();
  const branch = `alxp/${shortId}/${slug}`;

  try {
    git(projectRoot, `checkout -b "${branch}"`);

    const filesWritten: string[] = [];
    for (const [relPath, content] of files) {
      if (relPath.includes("..") || relPath.startsWith("/")) {
        console.warn(`  Skipping unsafe path: ${relPath}`);
        continue;
      }

      const absPath = resolve(projectRoot, relPath);
      const normalized = relative(projectRoot, absPath);
      if (normalized.startsWith("..")) {
        console.warn(`  Skipping path outside project: ${relPath}`);
        continue;
      }

      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, "utf-8");
      filesWritten.push(relPath);
    }

    if (filesWritten.length === 0) {
      git(projectRoot, `checkout "${originalBranch}"`);
      git(projectRoot, `branch -D "${branch}"`);
      throw new Error("No files were written (all paths were invalid)");
    }

    git(projectRoot, "add -A");

    const workerSuffix = workerDid ? ` [worker:${workerDid.substring(0, 20)}...]` : "";
    const commitMsg = `alxp: ${objective} [task:${shortId}]${workerSuffix}`;
    git(projectRoot, `commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

    const commitHash = git(projectRoot, "rev-parse --short HEAD");

    git(projectRoot, `checkout "${originalBranch}"`);

    const diffCommand = `git diff ${originalBranch}...${branch}`;

    return { branch, filesWritten, commitHash, diffCommand };
  } catch (err) {
    try {
      git(projectRoot, `checkout "${originalBranch}"`);
    } catch {
      // Already on original branch or other issue
    }
    throw err;
  }
}
