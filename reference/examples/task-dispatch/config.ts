/**
 * Task Dispatch Configuration — CLI arg parsing and defaults.
 */

import { networkInterfaces } from "os";

export interface DispatchConfig {
  // Project
  projectRoot: string;
  taskFile: string | null;
  objective: string | null;
  files: string[];

  // Network
  registryUrl: string;
  registryPort: number;
  workerPort: number;
  requesterPort: number;
  localIp: string;
  localOnly: boolean;

  // Solver / capacity source
  solver: "echo" | "openai" | "claude";
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string | null;
  anthropicModel: string;

  // Capacity sharing
  subscriptionTier: string;
  capacitySharePercent: number;

  // Task board (pull-based discovery)
  taskBoard: boolean;

  // Timeouts
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
export function parseConfig(argv: string[] = process.argv.slice(2)): DispatchConfig {
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
  const registryPort = parseInt(args.get("registry-port") ?? "19600", 10);

  // Parse --files as comma-separated
  const filesArg = args.get("files");
  const files = filesArg ? filesArg.split(",").map((f) => f.trim()) : [];

  // Solver selection
  const solverArg = args.get("solver") ?? "echo";
  const solver = (solverArg === "llm" || solverArg === "openai")
    ? "openai"
    : solverArg === "claude"
      ? "claude"
      : "echo";

  return {
    projectRoot: args.get("project-root") ?? process.cwd(),
    taskFile: args.get("task-file") ?? null,
    objective: args.get("objective") ?? null,
    files,

    registryUrl: args.get("registry") ?? `http://${localIp}:${registryPort}`,
    registryPort,
    workerPort: parseInt(args.get("worker-port") ?? "19700", 10),
    requesterPort: parseInt(args.get("requester-port") ?? "19800", 10),
    localIp,
    localOnly,

    solver: solver as DispatchConfig["solver"],
    llmEndpoint: args.get("llm-endpoint") ?? "http://localhost:11434/v1/chat/completions",
    llmModel: args.get("llm-model") ?? "codellama",
    llmApiKey: args.get("llm-api-key") ?? process.env.OPENAI_API_KEY ?? null,
    anthropicModel: args.get("anthropic-model") ?? "claude-sonnet-4-20250514",

    // Capacity sharing — what percentage of your subscription to share
    subscriptionTier: args.get("subscription-tier") ?? (solver === "claude" ? "pro" : solver === "openai" ? "pro" : "local-gpu"),
    capacitySharePercent: parseInt(args.get("capacity-share") ?? "50", 10),

    taskBoard: args.has("task-board"),

    taskTimeoutMs: parseInt(args.get("task-timeout") ?? "120000", 10),
  };
}
