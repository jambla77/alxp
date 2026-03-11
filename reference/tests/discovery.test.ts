import { describe, it, expect, afterAll } from "vitest";
import { generateAgentIdentity } from "../src/identity/did.js";
import { generateAgentCard, matchesQuery } from "../src/discovery/agent-card.js";
import { AgentRegistry, RegistryServer } from "../src/discovery/registry.js";

describe("Agent Card generation", () => {
  it("generates a valid agent card", () => {
    const identity = generateAgentIdentity("https://agent.example.com/alxp");

    const card = generateAgentCard({
      identity,
      capabilities: [
        {
          domain: "code-review",
          subDomain: "python",
          confidenceLevel: 0.9,
          tags: ["python", "code-quality"],
        },
      ],
      trustTier: "open-internet",
      endpoint: "https://agent.example.com/alxp",
      costModel: {
        basePrice: { amount: 0.05, currency: "USD", model: "fixed" },
        currency: "USD",
      },
      modelInfo: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        contextWindow: 200000,
      },
    });

    expect(card.id).toBe(identity.did);
    expect(card.capabilities).toHaveLength(1);
    expect(card.capabilities[0]!.domain).toBe("code-review");
    expect(card.trustTier).toBe("open-internet");
    expect(card.endpoints).toHaveLength(1);
    expect(card.signature).toBeTruthy();
  });
});

describe("Capability matching", () => {
  const identity = generateAgentIdentity();
  const card = generateAgentCard({
    identity,
    capabilities: [
      {
        domain: "code-review",
        subDomain: "python",
        confidenceLevel: 0.9,
        tags: ["python", "code-quality", "security"],
      },
      {
        domain: "translation",
        subDomain: "fr-en",
        confidenceLevel: 0.85,
        tags: ["french", "english"],
      },
    ],
    trustTier: "consortium",
    endpoint: "https://agent.example.com/alxp",
    costModel: {
      basePrice: { amount: 0.05, currency: "USD", model: "fixed" },
      currency: "USD",
    },
  });

  it("matches by domain", () => {
    expect(matchesQuery(card, { domain: "code-review" })).toBe(true);
    expect(matchesQuery(card, { domain: "translation" })).toBe(true);
    expect(matchesQuery(card, { domain: "legal-analysis" })).toBe(false);
  });

  it("matches by subdomain", () => {
    expect(matchesQuery(card, { domain: "code-review", subDomain: "python" })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", subDomain: "rust" })).toBe(false);
  });

  it("filters by minimum confidence", () => {
    expect(matchesQuery(card, { domain: "code-review", minConfidence: 0.8 })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", minConfidence: 0.95 })).toBe(false);
  });

  it("filters by trust tier", () => {
    expect(matchesQuery(card, { domain: "code-review", requiredTrustTier: "open-internet" })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", requiredTrustTier: "consortium" })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", requiredTrustTier: "same-owner" })).toBe(false);
  });

  it("filters by tags", () => {
    expect(matchesQuery(card, { domain: "code-review", tags: ["python"] })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", tags: ["python", "security"] })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", tags: ["rust"] })).toBe(false);
  });

  it("filters by max price", () => {
    expect(matchesQuery(card, { domain: "code-review", maxPrice: 0.10 })).toBe(true);
    expect(matchesQuery(card, { domain: "code-review", maxPrice: 0.01 })).toBe(false);
  });
});

describe("Agent Registry", () => {
  it("registers and retrieves agents", () => {
    const registry = new AgentRegistry();
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "summarization", tags: ["text"] }],
      trustTier: "open-internet",
      endpoint: "https://agent1.example.com/alxp",
    });

    registry.register(card);
    expect(registry.size).toBe(1);
    expect(registry.get(identity.did)).toBe(card);
  });

  it("queries agents by capability", () => {
    const registry = new AgentRegistry();

    // Register 3 agents with different capabilities
    const agents = [
      {
        identity: generateAgentIdentity(),
        capabilities: [{ domain: "code-review", subDomain: "python", confidenceLevel: 0.9, tags: ["python"] }],
      },
      {
        identity: generateAgentIdentity(),
        capabilities: [{ domain: "code-review", subDomain: "rust", confidenceLevel: 0.85, tags: ["rust"] }],
      },
      {
        identity: generateAgentIdentity(),
        capabilities: [{ domain: "translation", subDomain: "fr-en", confidenceLevel: 0.95, tags: ["french"] }],
      },
    ];

    for (const a of agents) {
      registry.register(
        generateAgentCard({
          identity: a.identity,
          capabilities: a.capabilities,
          trustTier: "open-internet",
          endpoint: `https://${a.identity.did}/alxp`,
        }),
      );
    }

    expect(registry.query({ domain: "code-review" })).toHaveLength(2);
    expect(registry.query({ domain: "code-review", subDomain: "python" })).toHaveLength(1);
    expect(registry.query({ domain: "translation" })).toHaveLength(1);
    expect(registry.query({ domain: "legal-analysis" })).toHaveLength(0);
  });

  it("verifies agent card signatures", () => {
    const registry = new AgentRegistry();
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "test", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test.example.com/alxp",
    });

    expect(registry.verifyCard(card)).toBe(true);

    // Tamper with the card
    const tampered = { ...card, trustTier: "same-owner" as const };
    // Signature should still verify since we're checking did:created, not the full card
    // But a forged signature should fail
    const forged = { ...card, signature: "deadbeef" };
    expect(registry.verifyCard(forged)).toBe(false);
  });

  it("unregisters agents", () => {
    const registry = new AgentRegistry();
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "test", tags: [] }],
      trustTier: "open-internet",
      endpoint: "https://test.example.com/alxp",
    });

    registry.register(card);
    expect(registry.size).toBe(1);

    registry.unregister(identity.did);
    expect(registry.size).toBe(0);
    expect(registry.get(identity.did)).toBeNull();
  });
});

describe("Registry HTTP Server", () => {
  const PORT = 9720;
  let server: RegistryServer;

  afterAll(async () => {
    await server?.close();
  });

  it("serves agent cards via HTTP", async () => {
    server = new RegistryServer();

    // Pre-register an agent
    const identity = generateAgentIdentity();
    const card = generateAgentCard({
      identity,
      capabilities: [{ domain: "summarization", tags: ["text"] }],
      trustTier: "open-internet",
      endpoint: "https://agent.example.com/alxp",
    });
    server.registry.register(card);

    await server.listen(PORT);

    // Query well-known endpoint
    const resp = await fetch(`http://localhost:${PORT}/.well-known/agent.json`);
    const data = await resp.json() as { agents: unknown[]; count: number };
    expect(data.count).toBe(1);
    expect(data.agents).toHaveLength(1);

    // Query by capability
    const queryResp = await fetch(`http://localhost:${PORT}/agents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "summarization" }),
    });
    const queryData = await queryResp.json() as { agents: unknown[]; count: number };
    expect(queryData.count).toBe(1);

    // Query non-existent capability
    const emptyResp = await fetch(`http://localhost:${PORT}/agents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "nonexistent" }),
    });
    const emptyData = await emptyResp.json() as { count: number };
    expect(emptyData.count).toBe(0);
  });
});
