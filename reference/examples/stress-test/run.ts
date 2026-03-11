#!/usr/bin/env node
/**
 * Stress Test Orchestrator — starts registry, optionally workers, then requesters.
 *
 * Usage:
 *   # Local-only (all 30 agents on this machine):
 *   npx tsx examples/stress-test/run.ts --local-only
 *
 *   # Cross-network (workers on remote machine):
 *   npx tsx examples/stress-test/run.ts --remote-host 192.168.2.87
 *
 *   # Then on the remote machine:
 *   npx tsx examples/stress-test/worker-pool.ts \
 *     --registry http://<local-ip>:19600 --count 25 --port-start 19700
 */

import { RegistryServer } from "../../src/index.js";
import { parseConfig } from "./config.js";
import { WorkerPool } from "./worker-pool.js";
import { RequesterPool } from "./requester-pool.js";

async function main() {
  const config = parseConfig();

  console.log("╔══════════════════════════════════════════╗");
  console.log("║     ALXP Stress Test — Multi-Agent       ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();
  console.log(`  Mode:           ${config.localOnly ? "local-only" : "cross-network"}`);
  console.log(`  Local IP:       ${config.localIp}`);
  console.log(`  Registry:       ${config.registryUrl}`);
  console.log(`  Workers:        ${config.workerCount}`);
  console.log(`  Requesters:     ${config.requesterCount}`);
  console.log(`  Tasks/requester: ${config.tasksPerRequester}`);
  console.log(`  Total tasks:    ${config.requesterCount * config.tasksPerRequester}`);
  console.log(`  Concurrency:    ${config.concurrencyPerRequester} per requester`);
  console.log();

  // 1. Start registry
  const registry = new RegistryServer();
  await registry.listen(config.registryPort, "0.0.0.0");
  console.log(`Registry listening on port ${config.registryPort}`);

  // Cleanup handler
  let workerPool: WorkerPool | undefined;
  let requesterPool: RequesterPool | undefined;
  const cleanup = async () => {
    console.log("\nShutting down...");
    await requesterPool?.stop().catch(() => {});
    await workerPool?.stop().catch(() => {});
    await registry.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);

  // 2. Start workers (local-only mode) or wait for remote workers
  if (config.localOnly) {
    workerPool = new WorkerPool(config);
    await workerPool.start();
  } else if (config.remoteHost) {
    console.log(`Waiting for ${config.workerCount} workers from ${config.remoteHost}...`);
    console.log(`\n  On the remote machine, run:`);
    console.log(`    cd reference`);
    console.log(`    npx tsx examples/stress-test/worker-pool.ts \\`);
    console.log(`      --registry ${config.registryUrl} --count ${config.workerCount} --port-start ${config.workerPortStart}\n`);
    await waitForWorkers(config.registryUrl, config.workerCount, 120000);
  } else {
    console.log("Waiting for workers to register...");
    console.log(`\n  On a remote machine, run:`);
    console.log(`    cd reference`);
    console.log(`    npx tsx examples/stress-test/worker-pool.ts \\`);
    console.log(`      --registry ${config.registryUrl} --count ${config.workerCount} --port-start ${config.workerPortStart}\n`);
    await waitForWorkers(config.registryUrl, 1, 120000);
  }

  // 3. Start requesters and dispatch
  requesterPool = new RequesterPool(config);
  await requesterPool.start();

  const workerCount = await requesterPool.discoverWorkers();
  if (workerCount === 0) {
    console.error("No workers found! Exiting.");
    await cleanup();
    return;
  }

  console.log(`\nStarting task dispatch...\n`);
  await requesterPool.run();

  // 4. Cleanup
  await requesterPool.stop();
  await workerPool?.stop();
  await registry.close();
  process.exit(0);
}

/** Poll registry until the expected number of workers register */
async function waitForWorkers(registryUrl: string, expected: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastCount = 0;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${registryUrl}/agents/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "computation" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { count: number };
        if (data.count !== lastCount) {
          lastCount = data.count;
          console.log(`  ${data.count}/${expected} workers registered...`);
        }
        if (data.count >= expected) {
          console.log(`All ${expected} workers registered.`);
          return;
        }
      }
    } catch {
      // Registry not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (lastCount > 0) {
    console.log(`Timeout waiting for all workers. Proceeding with ${lastCount}.`);
  } else {
    throw new Error(`No workers registered within ${timeoutMs / 1000}s`);
  }
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
