/**
 * Stress test configuration — shared constants and CLI arg parsing.
 */

import { networkInterfaces } from "os";

export interface StressConfig {
  registryPort: number;
  workerPortStart: number;
  requesterPortStart: number;
  workerCount: number;
  requesterCount: number;
  tasksPerRequester: number;
  concurrencyPerRequester: number;
  remoteHost: string | null;
  localOnly: boolean;
  registryUrl: string;
  localIp: string;
  taskTimeoutMs: number;
}

/** Detect this machine's LAN IP */
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

/** Parse CLI args into config */
export function parseConfig(argv: string[] = process.argv.slice(2)): StressConfig {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, "true");
      }
    }
  }

  const localOnly = args.has("local-only");
  const localIp = args.get("local-ip") ?? detectLocalIp();
  const remoteHost = args.get("remote-host") ?? null;
  const registryPort = parseInt(args.get("registry-port") ?? "19600", 10);

  return {
    registryPort,
    workerPortStart: parseInt(args.get("worker-port-start") ?? "19700", 10),
    requesterPortStart: parseInt(args.get("requester-port-start") ?? "19800", 10),
    workerCount: parseInt(args.get("worker-count") ?? "25", 10),
    requesterCount: parseInt(args.get("requester-count") ?? "5", 10),
    tasksPerRequester: parseInt(args.get("tasks-per-requester") ?? "50", 10),
    concurrencyPerRequester: parseInt(args.get("concurrency") ?? "5", 10),
    remoteHost,
    localOnly,
    registryUrl: args.get("registry") ?? `http://${localIp}:${registryPort}`,
    localIp,
    taskTimeoutMs: parseInt(args.get("task-timeout") ?? "30000", 10),
  };
}
