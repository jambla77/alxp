#!/usr/bin/env node
/**
 * Task Dispatch CLI — requester side entry point.
 *
 * Usage:
 *   # From tasks.json:
 *   npx tsx examples/task-dispatch/dispatch.ts \
 *     --project-root /path/to/project --task-file tasks.json
 *
 *   # Ad-hoc:
 *   npx tsx examples/task-dispatch/dispatch.ts \
 *     --project-root /path/to/project \
 *     --objective "Fix the sorting bug" \
 *     --files src/utils.ts,src/utils.test.ts
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { parseConfig } from "./config.js";
import { TaskDispatcher } from "./requester.js";
import type { TaskDefinition, TasksFile } from "./types.js";

async function main() {
  const config = parseConfig();

  // Build task list
  let tasks: TaskDefinition[];

  if (config.taskFile) {
    const raw = await readFile(join(config.projectRoot, config.taskFile), "utf-8");
    const parsed = JSON.parse(raw) as TasksFile;
    tasks = parsed.tasks;
    console.log(`Loaded ${tasks.length} task(s) from ${config.taskFile}`);
  } else if (config.objective) {
    tasks = [{
      objective: config.objective,
      context: config.files.length > 0 ? { files: config.files } : undefined,
      tags: [],
    }];
  } else {
    console.error("Error: provide --task-file or --objective");
    process.exit(1);
  }

  console.log();
  console.log("Task Dispatch — Requester");
  console.log(`  Project:  ${config.projectRoot}`);
  console.log(`  Registry: ${config.registryUrl}`);
  console.log(`  Tasks:    ${tasks.length}`);
  console.log();

  const dispatcher = new TaskDispatcher(config);
  await dispatcher.start();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await dispatcher.stop();
    process.exit(0);
  });

  // Discover workers
  const workerCount = await dispatcher.discoverWorkers();
  if (workerCount === 0) {
    console.error("No coding workers found in the registry. Start a worker first.");
    await dispatcher.stop();
    process.exit(1);
  }
  console.log(`Found ${workerCount} coding worker(s).`);

  // Dispatch all tasks
  const results = await dispatcher.dispatch(tasks);

  // Report
  console.log("\n" + "═".repeat(60));
  console.log("Results:");
  console.log("═".repeat(60));

  for (const r of results) {
    const icon = r.status === "completed" ? "OK" : r.status === "timeout" ? "TIMEOUT" : "FAIL";
    console.log(`\n  [${icon}] ${r.objective} (${r.durationMs}ms)`);

    if (r.merge) {
      console.log(`    Branch: ${r.merge.branch}`);
      console.log(`    Files:  ${r.merge.filesWritten.join(", ")}`);
      console.log(`    Commit: ${r.merge.commitHash}`);
      console.log(`    Review: ${r.merge.diffCommand}`);
    }
    if (r.error) {
      console.log(`    Error: ${r.error}`);
    }
  }

  const completed = results.filter((r) => r.status === "completed").length;
  console.log(`\n${completed}/${results.length} tasks completed.\n`);

  await dispatcher.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error("Dispatch failed:", err);
  process.exit(1);
});
