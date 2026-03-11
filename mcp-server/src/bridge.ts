/**
 * ALXP Bridge — orchestrates the full task lifecycle.
 *
 * Wraps ALXPClient (sending) + ALXPServer (receiving bids/results)
 * + registry HTTP calls into high-level operations.
 */

import { ulid } from "ulid";
import {
  ALXPServer,
  ALXPClient,
  signString,
} from "@alxp/reference";
import type {
  AgentIdentity,
} from "@alxp/reference";
import type {
  AgentDescription,
  AnnounceTask,
  Award,
  Verify,
  DID,
} from "@alxp/reference";
import { StateStore } from "./state.js";
import type { TrackedTask, TrackedOffer } from "./state.js";

interface OutsourceOptions {
  objective: string;
  domain: string;
  inputs?: Array<{ name: string; mimeType?: string; data: string }>;
  budgetMax?: number;
  budgetCurrency?: string;
  timeoutMs?: number;
  tags?: string[];
}

interface AgentSearchResult {
  did: string;
  endpoint: string;
  capabilities: Array<{ domain: string; subDomain?: string; confidenceLevel?: number; tags: string[] }>;
  costModel?: { basePrice?: { amount: number; currency: string } };
  trustTier: string;
}

export class ALXPBridge {
  private server: ALXPServer;
  private client: ALXPClient;
  private listenerPort = 0;
  private listenerReady = false;

  // Callbacks for pending operations
  private bidResolvers = new Map<string, (offer: TrackedOffer) => void>();
  private resultResolvers = new Map<string, (result: unknown) => void>();

  constructor(
    private readonly identity: AgentIdentity,
    private readonly registryUrl: string,
    private readonly state: StateStore,
  ) {
    this.server = new ALXPServer();
    this.client = new ALXPClient(identity.did, identity.keyPair.privateKey);
    this.setupHandlers();
  }

  /** Safely extract a string from an unknown value */
  private str(val: unknown, fallback = ""): string {
    return typeof val === "string" ? val : fallback;
  }

  /** Safely extract a finite number from an unknown value */
  private num(val: unknown, fallback = 0): number {
    return typeof val === "number" && Number.isFinite(val) ? val : fallback;
  }

  private setupHandlers(): void {
    // Handle incoming bids
    this.server.router.on("BID", async (msg) => {
      const payload = msg.payload;
      if (!payload || typeof payload !== "object") return;
      const offer = (payload as Record<string, unknown>)["offer"];
      if (!offer || typeof offer !== "object") return;
      const offerRec = offer as Record<string, unknown>;
      const taskId = this.str(offerRec["taskId"]);
      if (!taskId) return;

      const price = offerRec["price"];
      const priceRec = price && typeof price === "object" ? (price as Record<string, unknown>) : {};

      const tracked: TrackedOffer = {
        offerId: this.str(offerRec["id"]) || ulid(),
        workerDid: msg.sender,
        workerEndpoint: this.str(msg.headers?.["reply-endpoint"]),
        price: this.num(priceRec["amount"]),
        currency: this.str(priceRec["currency"], "USD"),
        confidence: this.num(offerRec["confidence"]),
        estimatedDuration: typeof offerRec["estimatedDuration"] === "string" ? offerRec["estimatedDuration"] : undefined,
      };

      // Store the offer
      const task = this.state.get(taskId);
      if (task) {
        task.offers.push(tracked);
        this.state.update(taskId, { offers: task.offers, status: "bidding" });
      }

      // Notify any waiting outsource operation
      const resolver = this.bidResolvers.get(taskId);
      if (resolver) {
        this.bidResolvers.delete(taskId);
        resolver(tracked);
      }
    });

    // Handle incoming results
    this.server.router.on("SUBMIT_RESULT", async (msg) => {
      const payload = msg.payload;
      if (!payload || typeof payload !== "object") return;
      const result = (payload as Record<string, unknown>)["result"];
      if (!result || typeof result !== "object") return;
      const resultRec = result as Record<string, unknown>;
      const contractId = this.str(resultRec["contractId"]);
      if (!contractId) return;

      // Find the task by contractId
      for (const task of this.state.list()) {
        if (task.awardedTo?.contractId === contractId) {
          const rawOutputs = Array.isArray(resultRec["outputs"]) ? resultRec["outputs"] : [];
          const outputs = rawOutputs
            .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
            .map((o) => ({
              name: this.str(o["name"], "output"),
              mimeType: this.str(o["mimeType"], "text/plain"),
              data: this.str(o["data"]),
            }));

          this.state.update(task.taskId, {
            status: "submitted",
            result: { contractId, outputs },
          });

          // Notify any waiting operation
          const resolver = this.resultResolvers.get(task.taskId);
          if (resolver) {
            this.resultResolvers.delete(task.taskId);
            resolver(resultRec);
          }
          break;
        }
      }
    });
  }

  /** Start the local HTTP listener for receiving bids and results */
  async start(): Promise<void> {
    const configPort = process.env["ALXP_LISTENER_PORT"];
    this.listenerPort = configPort ? parseInt(configPort, 10) : 19800;
    await this.server.listen(this.listenerPort);
    this.listenerReady = true;
  }

  /** Stop the listener */
  async stop(): Promise<void> {
    await this.server.close();
    this.listenerReady = false;
  }

  /** Get the local endpoint URL */
  get endpoint(): string {
    return `http://localhost:${this.listenerPort}`;
  }

  /** Search the registry for agents matching a query */
  async findAgents(query: {
    domain: string;
    tags?: string[];
    maxPrice?: number;
    maxResults?: number;
  }): Promise<AgentSearchResult[]> {
    const body: Record<string, unknown> = { domain: query.domain };
    if (query.tags) body["tags"] = query.tags;
    if (query.maxPrice !== undefined) body["maxPrice"] = query.maxPrice;

    const res = await fetch(`${this.registryUrl}/agents/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Registry query failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { agents: AgentDescription[]; count: number };
    const limit = query.maxResults ?? 10;

    return data.agents.slice(0, limit).map((a) => ({
      did: a.id,
      endpoint: a.endpoints[0]?.url ?? "",
      capabilities: a.capabilities.map((c) => ({
        domain: c.domain,
        subDomain: c.subDomain,
        confidenceLevel: c.confidenceLevel,
        tags: c.tags,
      })),
      costModel: a.costModel ? {
        basePrice: a.costModel.basePrice ? {
          amount: a.costModel.basePrice.amount,
          currency: a.costModel.basePrice.currency,
        } : undefined,
      } : undefined,
      trustTier: a.trustTier,
    }));
  }

  /**
   * Outsource a task — full lifecycle:
   * 1. Create TaskSpec
   * 2. Discover workers from registry
   * 3. Send ANNOUNCE_TASK
   * 4. Wait for bids
   * 5. Award best bid
   * 6. Wait for result
   */
  async outsourceTask(opts: OutsourceOptions): Promise<TrackedTask> {
    if (!this.listenerReady) {
      await this.start();
    }

    const taskId = ulid();
    const timeoutMs = opts.timeoutMs ?? parseInt(process.env["ALXP_DEFAULT_TIMEOUT"] ?? "120000", 10);

    // Track the task
    this.state.create(taskId, opts.objective, opts.domain);

    try {
      // 1. Discover workers
      const workers = await this.findAgents({
        domain: opts.domain,
        tags: opts.tags,
        maxPrice: opts.budgetMax,
      });

      if (workers.length === 0) {
        this.state.update(taskId, { status: "failed", error: "No agents found for this domain" });
        return this.state.get(taskId)!;
      }

      // 2. Build TaskSpec
      const taskSpec = {
        id: taskId,
        requester: this.identity.did,
        created: new Date().toISOString(),
        objective: opts.objective,
        domain: opts.domain,
        inputs: (opts.inputs ?? []).map((i) => ({
          name: i.name,
          mimeType: i.mimeType ?? "text/plain",
          data: i.data,
        })),
        expectedOutput: {
          mimeType: "text/plain",
          description: "Task output",
        },
        privacyClass: "public" as const,
        delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: false },
        acceptanceCriteria: [{ type: "schema" as const, schema: { type: "object" } }],
        verificationMethod: "optimistic" as const,
        tags: opts.tags ?? [],
        signature: signString(taskId, this.identity.keyPair.privateKey),
      };

      // 3. Send ANNOUNCE_TASK to all discovered workers
      const announcePayload: AnnounceTask = { type: "ANNOUNCE_TASK", taskSpec };
      const sendPromises = workers.map((w) =>
        this.client.send(w.endpoint, announcePayload, {
          recipient: w.did as DID,
          headers: { "reply-endpoint": this.endpoint },
        }).catch(() => null),
      );
      await Promise.allSettled(sendPromises);

      this.state.update(taskId, { status: "searching" });

      // 4. Wait for first bid
      const bid = await this.waitForBid(taskId, Math.min(timeoutMs, 30000));
      if (!bid) {
        this.state.update(taskId, { status: "timeout", error: "No bids received within timeout" });
        return this.state.get(taskId)!;
      }

      // 5. Award the contract
      const contractId = ulid();
      const workerEndpoint = bid.workerEndpoint || workers.find((w) => w.did === bid.workerDid)?.endpoint;
      if (!workerEndpoint) {
        this.state.update(taskId, { status: "failed", error: "Could not determine worker endpoint" });
        return this.state.get(taskId)!;
      }

      const contract = {
        id: contractId,
        taskId,
        offerId: bid.offerId,
        requester: this.identity.did,
        worker: bid.workerDid as DID,
        agreedPrice: { amount: bid.price, currency: bid.currency, model: "fixed" as const },
        agreedDeadline: new Date(Date.now() + timeoutMs).toISOString(),
        agreedVerification: { method: "schema-check" },
        delegationGrant: {
          issuer: this.identity.did,
          audience: bid.workerDid as DID,
          capabilities: ["context/read"],
          expiration: new Date(Date.now() + timeoutMs).toISOString(),
          token: signString(`${contractId}:grant`, this.identity.keyPair.privateKey),
        },
        cancellationPolicy: { allowedBy: "both" as const, penaltyPercent: 0 },
        requesterSignature: signString(contractId, this.identity.keyPair.privateKey),
        workerSignature: signString(contractId, this.identity.keyPair.privateKey),
        formed: new Date().toISOString(),
      };

      await this.client.send(workerEndpoint, { type: "AWARD", contract } satisfies Award, {
        recipient: bid.workerDid as DID,
        headers: {
          "reply-endpoint": this.endpoint,
          "task-objective": opts.objective,
        },
      });

      this.state.update(taskId, {
        status: "awarded",
        awardedTo: {
          workerDid: bid.workerDid,
          workerEndpoint,
          contractId,
        },
      });

      // 6. Wait for result
      const result = await this.waitForResult(taskId, timeoutMs);
      if (!result) {
        this.state.update(taskId, { status: "timeout", error: "Worker did not submit result within timeout" });
      }

      return this.state.get(taskId)!;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.update(taskId, { status: "failed", error: message });
      return this.state.get(taskId)!;
    }
  }

  /** Accept a submitted result */
  async acceptResult(taskId: string, qualityScore?: number): Promise<TrackedTask | undefined> {
    const task = this.state.get(taskId);
    if (!task || task.status !== "submitted" || !task.awardedTo) return undefined;

    const receiptId = ulid();
    const receipt = {
      id: receiptId,
      contractId: task.awardedTo.contractId,
      taskId,
      requester: this.identity.did,
      worker: task.awardedTo.workerDid as DID,
      status: "accepted" as const,
      acceptedAt: new Date().toISOString(),
      qualityScore: qualityScore ?? 0.8,
      timelinessScore: 1.0,
      taskDomain: task.domain,
      requesterSignature: signString(receiptId, this.identity.keyPair.privateKey),
      workerSignature: signString(receiptId, this.identity.keyPair.privateKey),
    };

    const verifyPayload: Verify = {
      type: "VERIFY",
      contractId: task.awardedTo.contractId,
      verdict: "accepted",
      receipt,
    };

    await this.client.send(task.awardedTo.workerEndpoint, verifyPayload, {
      recipient: task.awardedTo.workerDid as DID,
    });

    return this.state.update(taskId, {
      status: "accepted",
      qualityScore: qualityScore ?? 0.8,
    });
  }

  /** Reject a submitted result */
  async rejectResult(taskId: string, feedback?: string): Promise<TrackedTask | undefined> {
    const task = this.state.get(taskId);
    if (!task || task.status !== "submitted" || !task.awardedTo) return undefined;

    const verifyPayload: Verify = {
      type: "VERIFY",
      contractId: task.awardedTo.contractId,
      verdict: "rejected",
    };

    await this.client.send(task.awardedTo.workerEndpoint, verifyPayload, {
      recipient: task.awardedTo.workerDid as DID,
    });

    return this.state.update(taskId, {
      status: "rejected",
      feedback,
    });
  }

  private waitForBid(taskId: string, timeoutMs: number): Promise<TrackedOffer | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bidResolvers.delete(taskId);
        resolve(null);
      }, timeoutMs);

      this.bidResolvers.set(taskId, (offer) => {
        clearTimeout(timer);
        resolve(offer);
      });
    });
  }

  private waitForResult(taskId: string, timeoutMs: number): Promise<unknown | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resultResolvers.delete(taskId);
        resolve(null);
      }, timeoutMs);

      this.resultResolvers.set(taskId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }
}
