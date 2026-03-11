/**
 * Result Merger — writes task outputs to a git branch and commits.
 *
 * Creates a branch per task: alxp/<task-id>/<objective-slug>
 * Validates no path traversal, writes files, commits, switches back.
 */

import { execSync } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import type { MergeResult } from "./types.js";

/** Slugify an objective string for use in branch names */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40);
}

/** Run a git command in the project root */
function git(projectRoot: string, cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: projectRoot,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/**
 * Merge task outputs into a new git branch.
 *
 * @param projectRoot - Absolute path to the project
 * @param taskId - ALXP task ID
 * @param objective - Task objective (for branch name)
 * @param files - Map of relative path → new content
 * @param workerDid - Worker's DID (for commit message)
 * @returns MergeResult with branch name, files written, commit hash
 */
export async function mergeResult(
  projectRoot: string,
  taskId: string,
  objective: string,
  files: Map<string, string>,
  workerDid?: string,
): Promise<MergeResult> {
  // 1. Check for dirty working tree
  const status = git(projectRoot, "status --porcelain");
  if (status.length > 0) {
    throw new Error(
      "Working tree has uncommitted changes. Commit or stash before merging ALXP results.\n" +
      `  git status:\n${status}`,
    );
  }

  // Record current branch to switch back
  const originalBranch = git(projectRoot, "rev-parse --abbrev-ref HEAD");

  // 2. Create branch name
  const slug = slugify(objective);
  const shortId = taskId.substring(0, 8).toLowerCase();
  const branch = `alxp/${shortId}/${slug}`;

  try {
    // 3. Create and switch to new branch
    git(projectRoot, `checkout -b "${branch}"`);

    // 4. Write files (validate no path traversal)
    const filesWritten: string[] = [];
    for (const [relPath, content] of files) {
      // Security: prevent path traversal
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

      // Ensure directory exists
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, "utf-8");
      filesWritten.push(relPath);
    }

    if (filesWritten.length === 0) {
      // No files written — clean up branch
      git(projectRoot, `checkout "${originalBranch}"`);
      git(projectRoot, `branch -D "${branch}"`);
      throw new Error("No files were written (all paths were invalid)");
    }

    // 5. Stage and commit
    git(projectRoot, "add -A");

    const workerSuffix = workerDid ? ` [worker:${workerDid.substring(0, 20)}...]` : "";
    const commitMsg = `alxp: ${objective} [task:${shortId}]${workerSuffix}`;
    git(projectRoot, `commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

    const commitHash = git(projectRoot, "rev-parse --short HEAD");

    // 6. Switch back
    git(projectRoot, `checkout "${originalBranch}"`);

    const diffCommand = `git diff ${originalBranch}...${branch}`;

    return { branch, filesWritten, commitHash, diffCommand };
  } catch (err) {
    // Try to switch back on error
    try {
      git(projectRoot, `checkout "${originalBranch}"`);
    } catch {
      // Already on original branch or other issue
    }
    throw err;
  }
}
