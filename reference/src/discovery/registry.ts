/**
 * Agent Registry — in-memory registry for agent discovery.
 *
 * In production, this would be backed by a database or DHT.
 * Agents publish their Agent Cards to the registry, and other
 * agents query the registry to find workers for their tasks.
 */

import type { AgentDescription as AgentDescriptionType, DID } from "../types/index.js";
import type { CapabilityDescription as CapabilityDescriptionType } from "../types/index.js";
import { matchesQuery, type CapabilityQuery } from "./agent-card.js";
import { verifyString, hexToPublicKey } from "../identity/signing.js";
import { publicKeyFromDID } from "../identity/did.js";
import { TaskBoard, verifyTaskSignature, type TaskQuery } from "./task-board.js";
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
  readonly taskBoard: TaskBoard;
  private server: ServerType | null = null;

  constructor(registry?: AgentRegistry, taskBoard?: TaskBoard) {
    this.app = new Hono();
    this.registry = registry ?? new AgentRegistry();
    this.taskBoard = taskBoard ?? new TaskBoard();
    this.setupRoutes();
  }

  /**
   * Verify a signed deletion request.
   * The caller must provide X-ALXP-Signature header signing "delete:{resourceId}".
   */
  private verifyDeleteAuth(
    signature: string | undefined,
    resourceId: string,
    publicKeyHex: string,
  ): boolean {
    if (!signature) return false;
    try {
      const pubKey = hexToPublicKey(publicKeyHex);
      return verifyString(signature, `delete:${resourceId}`, pubKey);
    } catch {
      return false;
    }
  }

  private setupRoutes() {
    // CORS — restrict to same-origin by default
    this.app.use("*", async (c, next) => {
      await next();
      c.header("X-Content-Type-Options", "nosniff");
    });

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

    // Remove agent (requires signature proving DID ownership)
    this.app.delete("/agents/:did", (c) => {
      const did = decodeURIComponent(c.req.param("did")) as DID;

      const card = this.registry.get(did);
      if (!card) {
        return c.json({ error: "Agent not found" }, 404);
      }

      const signature = c.req.header("x-alxp-signature");
      if (!this.verifyDeleteAuth(signature, did, card.publicKey)) {
        return c.json({ error: "Unauthorized: valid signature required to delete agent" }, 401);
      }

      this.registry.unregister(did);
      return c.json({ status: "removed", did });
    });

    // ── Task Board Routes ──

    // Post a signed task to the board
    this.app.post("/tasks", async (c) => {
      const body = (await c.req.json()) as { taskSpec: any; replyEndpoint: string };

      if (!verifyTaskSignature(body.taskSpec)) {
        return c.json({ error: "Invalid task signature" }, 401);
      }

      try {
        const posted = this.taskBoard.post(body.taskSpec, body.replyEndpoint);
        return c.json({ status: "posted", taskId: body.taskSpec.id, expiresAt: posted.expiresAt }, 201);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Failed to post task" }, 400);
      }
    });

    // Get a specific posted task
    this.app.get("/tasks/:id", (c) => {
      const id = c.req.param("id");
      const posted = this.taskBoard.get(id);
      if (!posted) {
        return c.json({ error: "Task not found" }, 404);
      }
      return c.json(posted);
    });

    // Browse tasks by domain/tags/budget
    this.app.post("/tasks/query", async (c) => {
      const query = (await c.req.json()) as TaskQuery;
      const tasks = this.taskBoard.query(query);
      return c.json({ tasks, count: tasks.length });
    });

    // Find tasks for a worker based on capabilities
    this.app.post("/tasks/match", async (c) => {
      const body = (await c.req.json()) as { capabilities: CapabilityDescriptionType[] };
      const tasks = this.taskBoard.matchForWorker(body.capabilities);
      return c.json({ tasks, count: tasks.length });
    });

    // Remove a task (requires signature from the task requester)
    this.app.delete("/tasks/:id", (c) => {
      const id = c.req.param("id");

      const posted = this.taskBoard.get(id);
      if (!posted) {
        return c.json({ error: "Task not found" }, 404);
      }

      // Verify the caller is the task requester
      const signature = c.req.header("x-alxp-signature");
      const requesterDid = posted.taskSpec.requester as DID;
      let pubKeyHex: string;
      try {
        pubKeyHex = publicKeyFromDID(requesterDid);
      } catch {
        return c.json({ error: "Cannot resolve requester key" }, 400);
      }

      if (!this.verifyDeleteAuth(signature, id, pubKeyHex)) {
        return c.json({ error: "Unauthorized: valid signature required to delete task" }, 401);
      }

      this.taskBoard.remove(id);
      return c.json({ status: "removed", taskId: id });
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
