/**
 * `alxp serve` — Start a standalone worker that accepts tasks from the network.
 */

import { networkInterfaces } from "os";
import { CodingWorker } from "../lib/worker.js";
import { createSolver } from "../lib/solver-factory.js";

export interface ServeOptions {
  solver?: string;
  model?: string;
  llmEndpoint?: string;
  apiKey?: string;
  registry?: string;
  port?: string;
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

export async function serveWorker(opts: ServeOptions): Promise<void> {
  const port = parseInt(opts.port ?? "19700", 10);
  const registryUrl = opts.registry ?? "http://127.0.0.1:19600";

  const solverName = opts.solver ?? "echo";
  const solver = (solverName === "openai" || solverName === "llm")
    ? "openai" as const
    : solverName === "claude"
      ? "claude" as const
      : "echo" as const;

  const llmModel = opts.model ?? (solver === "claude" ? "claude-sonnet-4-20250514" : "codellama");

  const taskSolver = await createSolver({
    solver,
    llmEndpoint: opts.llmEndpoint ?? "http://localhost:11434/v1/chat/completions",
    llmModel,
    llmApiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? null,
    anthropicModel: solver === "claude" ? llmModel : "claude-sonnet-4-20250514",
  });

  const localIp = detectLocalIp();
  const endpoint = `http://${localIp}:${port}`;
  const subscriptionTier = opts.subscriptionTier ?? (solver === "claude" ? "pro" : solver === "openai" ? "pro" : "local-gpu");
  const capacitySharePercent = parseInt(opts.capacityShare ?? "50", 10);

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  ALXP Worker                                 ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Solver:   ${taskSolver.name}`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Registry: ${registryUrl}`);
  console.log();

  const worker = new CodingWorker({
    port,
    hostname: "0.0.0.0",
    endpoint,
    registryUrl,
    solver: taskSolver,
    subscriptionTier,
    capacitySharePercent,
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down worker...");
    await worker.stop();
    process.exit(0);
  });

  await worker.start();
  console.log("\nWaiting for tasks... (Ctrl+C to stop)\n");
}
