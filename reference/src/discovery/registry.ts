/**
 * Agent Registry — in-memory registry for agent discovery.
 *
 * In production, this would be backed by a database or DHT.
 * Agents publish their Agent Cards to the registry, and other
 * agents query the registry to find workers for their tasks.
 */

import type { AgentDescription as AgentDescriptionType, DID } from "../types/index.js";
import { matchesQuery, type CapabilityQuery } from "./agent-card.js";
import { verifyString, hexToPublicKey } from "../identity/signing.js";
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";

/** Agent Registry — stores and queries agent cards */
export class AgentRegistry {
  private agents = new Map<DID, AgentDescriptionType>();

  /** Register or update an agent card */
  register(card: AgentDescriptionType): void {
    this.agents.set(card.id, card);
  }

  /** Remove an agent from the registry */
  unregister(did: DID): boolean {
    return this.agents.delete(did);
  }

  /** Get a specific agent's card */
  get(did: DID): AgentDescriptionType | null {
    return this.agents.get(did) ?? null;
  }

  /** Query agents matching capability requirements */
  query(query: CapabilityQuery): AgentDescriptionType[] {
    return [...this.agents.values()].filter((card) => matchesQuery(card, query));
  }

  /** Get all registered agents */
  list(): AgentDescriptionType[] {
    return [...this.agents.values()];
  }

  /** Number of registered agents */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Verify an agent card's signature.
   * Returns true if the card's signature is valid for the claimed public key.
   */
  verifyCard(card: AgentDescriptionType): boolean {
    try {
      const publicKey = hexToPublicKey(card.publicKey);
      // The signature covers "did:timestamp"
      // We verify the signature format is valid for the public key
      // In a full implementation, we'd verify the exact signed payload
      return verifyString(
        card.signature,
        `${card.id}:${card.created}`,
        publicKey,
      );
    } catch {
      return false;
    }
  }
}

/** Registry HTTP Server — serves agent cards via well-known endpoint */
export class RegistryServer {
  readonly app: Hono;
  readonly registry: AgentRegistry;
  private server: ServerType | null = null;

  constructor(registry?: AgentRegistry) {
    this.app = new Hono();
    this.registry = registry ?? new AgentRegistry();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Well-known agent card endpoint (A2A-style)
    this.app.get("/.well-known/agent.json", (c) => {
      const agents = this.registry.list();
      return c.json({ agents, count: agents.length });
    });

    // Get specific agent
    this.app.get("/agents/:did", (c) => {
      const did = decodeURIComponent(c.req.param("did")) as DID;
      const card = this.registry.get(did);
      if (!card) {
        return c.json({ error: "Agent not found" }, 404);
      }
      return c.json(card);
    });

    // Register agent
    this.app.post("/agents", async (c) => {
      const card = (await c.req.json()) as AgentDescriptionType;

      // Verify signature before registering
      if (!this.registry.verifyCard(card)) {
        return c.json({ error: "Invalid agent card signature" }, 401);
      }

      this.registry.register(card);
      return c.json({ status: "registered", did: card.id }, 201);
    });

    // Query agents by capability
    this.app.post("/agents/query", async (c) => {
      const query = (await c.req.json()) as CapabilityQuery;
      const results = this.registry.query(query);
      return c.json({ agents: results, count: results.length });
    });

    // Remove agent
    this.app.delete("/agents/:did", (c) => {
      const did = decodeURIComponent(c.req.param("did")) as DID;
      const removed = this.registry.unregister(did);
      if (!removed) {
        return c.json({ error: "Agent not found" }, 404);
      }
      return c.json({ status: "removed", did });
    });
  }

  /** Start the registry server */
  listen(port: number, hostname?: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port, hostname }, () => resolve());
    });
  }

  /** Stop the registry server */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
