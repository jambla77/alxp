/**
 * @alxp/mcp-server — MCP server for outsourcing tasks via the ALXP protocol.
 *
 * Exposes tools: find_agents, outsource_task, list_tasks, check_status, review_result
 *
 * Usage in MCP config:
 * {
 *   "mcpServers": {
 *     "alxp": {
 *       "command": "npx",
 *       "args": ["@alxp/mcp-server"],
 *       "env": { "ALXP_REGISTRY_URL": "http://localhost:19600" }
 *     }
 *   }
 * }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadOrCreateIdentity } from "./identity.js";
import { StateStore } from "./state.js";
import { ALXPBridge } from "./bridge.js";

import { definition as findAgentsDef, handler as findAgentsHandler } from "./tools/find-agents.js";
import { definition as outsourceTaskDef, handler as outsourceTaskHandler } from "./tools/outsource-task.js";
import { definition as listTasksDef, handler as listTasksHandler } from "./tools/list-tasks.js";
import { definition as checkStatusDef, handler as checkStatusHandler } from "./tools/check-status.js";
import { definition as reviewResultDef, handler as reviewResultHandler } from "./tools/review-result.js";

const REGISTRY_URL = process.env["ALXP_REGISTRY_URL"] ?? "http://localhost:19600";

async function main() {
  // Initialize state
  const state = new StateStore();
  await state.load();

  // Initialize identity (auto-generates on first run)
  const identity = await loadOrCreateIdentity();
  console.error(`ALXP MCP Server — identity: ${identity.did}`);
  console.error(`Registry: ${REGISTRY_URL}`);

  // Initialize bridge
  const bridge = new ALXPBridge(identity, REGISTRY_URL, state);

  // Create MCP server
  const server = new Server(
    { name: "alxp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // List available tools
  const tools = [
    findAgentsDef,
    outsourceTaskDef,
    listTasksDef,
    checkStatusDef,
    reviewResultDef,
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    try {
      let result: string;

      switch (name) {
        case "find_agents":
          result = await findAgentsHandler(bridge, safeArgs);
          break;

        case "outsource_task":
          result = await outsourceTaskHandler(bridge, safeArgs);
          break;

        case "list_tasks":
          result = listTasksHandler(state, safeArgs);
          break;

        case "check_status":
          result = checkStatusHandler(state, safeArgs);
          break;

        case "review_result":
          result = await reviewResultHandler(bridge, state, safeArgs);
          break;

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ALXP MCP Server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await bridge.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
