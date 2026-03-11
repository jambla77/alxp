#!/usr/bin/env node
/**
 * Task Dispatch Orchestrator — local-only mode for testing.
 *
 * Starts registry + worker + requester all on one machine.
 *
 * Usage:
 *   # Echo solver (pipeline test):
 *   cd reference
 *   npx tsx examples/task-dispatch/run.ts --local-only \
 *     --project-root /path/to/project --task-file tasks.json --solver echo
 *
 *   # LLM solver (Ollama):
 *   npx tsx examples/task-dispatch/run.ts --local-only \
 *     --project-root /path/to/project --objective "Add login form" \
 *     --files src/App.tsx --solver openai --llm-model codellama
 *
 *   # Claude solver:
 *   npx tsx examples/task-dispatch/run.ts --local-only \
 *     --project-root /path/to/project --objective "Add tests" \
 *     --files src/utils.ts --solver claude
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { RegistryServer } from "../../src/index.js";
import { parseConfig } from "./config.js";
import { CodingWorker } from "./worker.js";
import { TaskDispatcher } from "./requester.js";
import { createSolver } from "./solver-factory.js";
import type { TaskDefinition, TasksFile } from "./types.js";

async function main() {
  const config = parseConfig();

  // Build task list
  let tasks: TaskDefinition[];

  if (config.taskFile) {
    const raw = await readFile(join(config.projectRoot, config.taskFile), "utf-8");
    const parsed = JSON.parse(raw) as TasksFile;
    tasks = parsed.tasks;
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

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  ALXP Capacity Sharing — Task Dispatch       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Project:   ${config.projectRoot}`);
  console.log(`  Capacity:  ${config.solver} (${config.subscriptionTier} tier, sharing ${config.capacitySharePercent}%)`);
  console.log(`  Tasks:     ${tasks.length}`);
  console.log(`  Registry:  ${config.registryUrl}`);
  console.log(`  Mode:      ${config.taskBoard ? "task-board (pull)" : "direct (push)"}`);
  console.log();

  // 1. Start registry
  const registry = new RegistryServer();
  await registry.listen(config.registryPort, "0.0.0.0");
  console.log(`Registry listening on port ${config.registryPort}`);

  // Cleanup handler
  let worker: CodingWorker | undefined;
  let dispatcher: TaskDispatcher | undefined;
  const cleanup = async () => {
    console.log("\nShutting down...");
    await dispatcher?.stop().catch(() => {});
    await worker?.stop().catch(() => {});
    await registry.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);

  // 2. Start worker
  const solver = await createSolver(config);
  const hostname = config.localOnly ? "127.0.0.1" : "0.0.0.0";
  const endpointIp = config.localOnly ? "127.0.0.1" : config.localIp;
  const workerEndpoint = `http://${endpointIp}:${config.workerPort}`;

  worker = new CodingWorker({
    port: config.workerPort,
    hostname,
    endpoint: workerEndpoint,
    registryUrl: config.registryUrl,
    solver,
    subscriptionTier: config.subscriptionTier,
    capacitySharePercent: config.capacitySharePercent,
  });
  await worker.start();

  // 3. Start requester and dispatch
  dispatcher = new TaskDispatcher(config);
  await dispatcher.start();

  let results: Awaited<ReturnType<typeof dispatcher.dispatch>>;

  if (config.taskBoard) {
    // Pull-based: requester posts to board, worker polls and bids
    console.log("Using task-board mode (pull-based discovery)\n");
    await dispatcher.postToBoard(tasks);

    // Start worker polling the board
    await worker.pollBoard();

    // Wait for results
    results = await dispatcher.waitForResults();
  } else {
    // Push-based: requester queries registry and pushes tasks directly
    const workerCount = await dispatcher.discoverWorkers();
    if (workerCount === 0) {
      console.error("No workers found! (registration may have failed)");
      await cleanup();
      return;
    }

    results = await dispatcher.dispatch(tasks);
  }

  // 4. Report results
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

  // 5. Cleanup
  await dispatcher.stop();
  await worker.stop();
  await registry.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Task dispatch failed:", err);
  process.exit(1);
});
