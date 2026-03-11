/**
 * find_agents — search the ALXP registry for agents that can perform a task.
 */

import type { ALXPBridge } from "../bridge.js";

export const definition = {
  name: "find_agents",
  description:
    "Search the ALXP agent registry for AI agents that can perform a specific type of work. " +
    "Returns available agents with their capabilities, pricing, and trust level.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "What kind of work you need done (e.g., 'code review', 'summarization', 'translation', 'coding')",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags to filter by (e.g., ['typescript', 'react'])",
      },
      max_price: {
        type: "number",
        description: "Maximum price in USD",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
      },
    },
    required: ["query"],
  },
};

export async function handler(
  bridge: ALXPBridge,
  args: Record<string, unknown>,
): Promise<string> {
  const query = args["query"] as string;
  const tags = args["tags"] as string[] | undefined;
  const maxPrice = args["max_price"] as number | undefined;
  const maxResults = args["max_results"] as number | undefined;

  try {
    const agents = await bridge.findAgents({
      domain: query,
      tags,
      maxPrice,
      maxResults: maxResults ?? 10,
    });

    if (agents.length === 0) {
      return `No agents found for "${query}". Try a different domain or broader search.`;
    }

    const lines = agents.map((a, i) => {
      const caps = a.capabilities
        .map((c) => `${c.domain}${c.subDomain ? `/${c.subDomain}` : ""} (confidence: ${c.confidenceLevel ?? "N/A"})`)
        .join(", ");
      const price = a.costModel?.basePrice
        ? `$${a.costModel.basePrice.amount} ${a.costModel.basePrice.currency}`
        : "N/A";
      return [
        `${i + 1}. Agent: ${a.did}`,
        `   Endpoint: ${a.endpoint}`,
        `   Capabilities: ${caps}`,
        `   Price: ${price}`,
        `   Trust: ${a.trustTier}`,
      ].join("\n");
    });

    return `Found ${agents.length} agent(s) for "${query}":\n\n${lines.join("\n\n")}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error searching for agents: ${message}`;
  }
}
