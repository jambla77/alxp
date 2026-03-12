#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("alxp")
  .description("CLI for the ALXP protocol — share AI capacity, dispatch coding tasks")
  .version("0.1.0");

program
  .command("demo")
  .description("Run the capacity sharing demo (zero-config)")
  .action(async () => {
    const { runDemo } = await import("./commands/demo.js");
    await runDemo();
  });

program
  .command("run")
  .description("Dispatch a coding task through the ALXP lifecycle")
  .argument("<objective>", "Task objective (e.g., \"Add error handling\")")
  .option("--files <paths>", "Comma-separated file paths to include")
  .option("--solver <name>", "Solver to use: echo, openai, claude (default: echo)")
  .option("--model <name>", "LLM model name (default: codellama or claude-sonnet-4)")
  .option("--llm-endpoint <url>", "OpenAI-compatible API endpoint")
  .option("--api-key <key>", "API key for the LLM provider")
  .option("--task-file <path>", "Path to tasks.json (relative to project root)")
  .option("--project-root <path>", "Project root directory (default: cwd)")
  .option("--registry-port <port>", "Registry port (default: 19600)")
  .option("--worker-port <port>", "Worker port (default: 19700)")
  .option("--timeout <ms>", "Task timeout in ms (default: 120000)")
  .option("--subscription-tier <tier>", "Subscription tier label")
  .option("--capacity-share <percent>", "Percentage of capacity to share (default: 50)")
  .action(async (objective: string, opts) => {
    const { runTask } = await import("./commands/run.js");
    await runTask(objective, opts);
  });

program
  .command("serve")
  .description("Start a standalone worker that accepts tasks")
  .option("--solver <name>", "Solver to use: echo, openai, claude (default: echo)")
  .option("--model <name>", "LLM model name")
  .option("--llm-endpoint <url>", "OpenAI-compatible API endpoint")
  .option("--api-key <key>", "API key for the LLM provider")
  .option("--registry <url>", "Registry URL (default: http://127.0.0.1:19600)")
  .option("--port <port>", "Worker port (default: 19700)")
  .option("--subscription-tier <tier>", "Subscription tier label")
  .option("--capacity-share <percent>", "Percentage of capacity to share (default: 50)")
  .action(async (opts) => {
    const { serveWorker } = await import("./commands/serve.js");
    await serveWorker(opts);
  });

program
  .command("registry")
  .description("Start a standalone registry server")
  .option("--port <port>", "Registry port (default: 19600)")
  .option("--host <host>", "Bind host (default: 0.0.0.0)")
  .action(async (opts) => {
    const { startRegistry } = await import("./commands/registry.js");
    await startRegistry(opts);
  });

program.parse();
