#!/usr/bin/env node
/**
 * Coding Worker Server CLI — worker side entry point.
 *
 * Usage:
 *   npx tsx examples/task-dispatch/serve.ts \
 *     --registry http://192.168.2.81:19600 \
 *     --solver echo
 *
 *   npx tsx examples/task-dispatch/serve.ts \
 *     --registry http://192.168.2.81:19600 \
 *     --solver openai --llm-model codellama
 *
 *   npx tsx examples/task-dispatch/serve.ts \
 *     --registry http://192.168.2.81:19600 \
 *     --solver claude
 */

import { parseConfig } from "./config.js";
import { CodingWorker } from "./worker.js";
import { createSolver } from "./solver-factory.js";

async function main() {
  const config = parseConfig();
  const solver = await createSolver(config);

  const hostname = config.localOnly ? "127.0.0.1" : "0.0.0.0";
  const endpointIp = config.localOnly ? "127.0.0.1" : config.localIp;
  const endpoint = `http://${endpointIp}:${config.workerPort}`;

  console.log("Coding Worker Server");
  console.log(`  Solver:   ${solver.name}`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Registry: ${config.registryUrl}`);
  console.log();

  const worker = new CodingWorker({
    port: config.workerPort,
    hostname,
    endpoint,
    registryUrl: config.registryUrl,
    solver,
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down worker...");
    await worker.stop();
    process.exit(0);
  });

  await worker.start();
  console.log("\nWaiting for tasks... (Ctrl+C to stop)\n");
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
