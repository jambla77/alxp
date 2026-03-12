/**
 * `alxp run` — Dispatch a coding task through the full ALXP lifecycle.
 *
 * Starts registry + worker + requester in one process, auto-detects project root.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { networkInterfaces } from "os";
import { RegistryServer } from "@alxp/reference";
import { CodingWorker } from "../lib/worker.js";
import { TaskDispatcher } from "../lib/requester.js";
import { createSolver } from "../lib/solver-factory.js";
import type { TaskDefinition, TasksFile } from "../lib/types.js";

export interface RunOptions {
  files?: string;
  solver?: string;
  model?: string;
  llmEndpoint?: string;
  apiKey?: string;
  taskFile?: string;
  projectRoot?: string;
  registryPort?: string;
  workerPort?: string;
  timeout?: string;
  subscriptionTier?: string;
  capacityShare?: string;
}

function detectLocalIp(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export async function runTask(objective: string, opts: RunOptions): Promise<void> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const registryPort = parseInt(opts.registryPort ?? "19600", 10);
  const workerPort = parseInt(opts.workerPort ?? "19700", 10);
  const requesterPort = workerPort + 100; // 19800
  const localIp = "127.0.0.1";
  const registryUrl = `http://${localIp}:${registryPort}`;
  const taskTimeoutMs = parseInt(opts.timeout ?? "120000", 10);

  // Determine solver
  const solverName = opts.solver ?? "echo";
  const solver = (solverName === "openai" || solverName === "llm")
    ? "openai" as const
    : solverName === "claude"
      ? "claude" as const
      : "echo" as const;

  const llmModel = opts.model ?? (solver === "claude" ? "claude-sonnet-4-20250514" : "codellama");
  const subscriptionTier = opts.subscriptionTier ?? (solver === "claude" ? "pro" : solver === "openai" ? "pro" : "local-gpu");
  const capacitySharePercent = parseInt(opts.capacityShare ?? "50", 10);

  // Build task list
  let tasks: TaskDefinition[];

  if (opts.taskFile) {
    const raw = await readFile(join(projectRoot, opts.taskFile), "utf-8");
    const parsed = JSON.parse(raw) as TasksFile;
    tasks = parsed.tasks;
  } else {
    const files = opts.files ? opts.files.split(",").map((f) => f.trim()) : [];
    tasks = [{
      objective,
      context: files.length > 0 ? { files } : undefined,
      tags: [],
    }];
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  ALXP Task Dispatch                          ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Project:  ${projectRoot}`);
  console.log(`  Solver:   ${solver}${solver !== "echo" ? ` (${llmModel})` : ""}`);
  console.log(`  Tasks:    ${tasks.length}`);
  console.log();

  // 1. Start registry
  const registry = new RegistryServer();
  await registry.listen(registryPort, "0.0.0.0");
  console.log(`Registry listening on port ${registryPort}`);

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
  const taskSolver = await createSolver({
    solver,
    llmEndpoint: opts.llmEndpoint ?? "http://localhost:11434/v1/chat/completions",
    llmModel,
    llmApiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? null,
    anthropicModel: solver === "claude" ? llmModel : "claude-sonnet-4-20250514",
  });

  const workerEndpoint = `http://${localIp}:${workerPort}`;

  worker = new CodingWorker({
    port: workerPort,
    hostname: "127.0.0.1",
    endpoint: workerEndpoint,
    registryUrl,
    solver: taskSolver,
    subscriptionTier,
    capacitySharePercent,
  });
  await worker.start();

  // 3. Dispatch
  dispatcher = new TaskDispatcher({
    projectRoot,
    registryUrl,
    requesterPort,
    localIp,
    taskTimeoutMs,
  });
  await dispatcher.start();

  const workerCount = await dispatcher.discoverWorkers();
  if (workerCount === 0) {
    console.error("No workers found! (registration may have failed)");
    await cleanup();
    return;
  }

  const results = await dispatcher.dispatch(tasks);

  // 4. Report
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
