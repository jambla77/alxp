/**
 * `alxp registry` — Start a standalone registry server.
 */

import { RegistryServer } from "@alxp/reference";

export interface RegistryOptions {
  port?: string;
  host?: string;
}

export async function startRegistry(opts: RegistryOptions): Promise<void> {
  const port = parseInt(opts.port ?? "19600", 10);
  const host = opts.host ?? "0.0.0.0";

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  ALXP Registry                               ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  const registry = new RegistryServer();
  await registry.listen(port, host);

  console.log(`Registry listening on ${host}:${port}`);
  console.log("\nWorkers can register at:");
  console.log(`  http://<your-ip>:${port}/agents`);
  console.log("\nRequesters can discover workers at:");
  console.log(`  http://<your-ip>:${port}/agents/query`);
  console.log("\nCtrl+C to stop\n");

  process.on("SIGINT", async () => {
    console.log("\nShutting down registry...");
    await registry.close();
    process.exit(0);
  });
}
