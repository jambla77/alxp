import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import type { ProtocolMessage, MessagePayload } from "../types/index.js";
import { parseMessage, verifyMessage } from "../messages/envelope.js";
import { MessageRouter } from "../messages/handlers.js";

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
  id: number | string;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

/** Method name to payload type mapping */
const METHOD_MAP: Record<string, MessagePayload["type"]> = {
  "alxp.announceTask": "ANNOUNCE_TASK",
  "alxp.bid": "BID",
  "alxp.award": "AWARD",
  "alxp.submitResult": "SUBMIT_RESULT",
  "alxp.verify": "VERIFY",
  "alxp.settle": "SETTLE",
  "alxp.challengeResult": "CHALLENGE_RESULT",
  "alxp.validatorAssess": "VALIDATOR_ASSESS",
  "alxp.heartbeat": "HEARTBEAT",
  "alxp.meteringUpdate": "METERING_UPDATE",
};

/** ALXP HTTP Server using JSON-RPC 2.0 over HTTPS */
export class ALXPServer {
  readonly app: Hono;
  readonly router: MessageRouter;
  private server: ServerType | null = null;

  constructor() {
    this.app = new Hono();
    this.router = new MessageRouter();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.post("/alxp", async (c) => {
      let rpcRequest: JsonRpcRequest;
      try {
        rpcRequest = await c.req.json();
      } catch {
        return c.json(this.rpcError(null, -32700, "Parse error"), 200);
      }

      // Validate JSON-RPC structure
      if (rpcRequest.jsonrpc !== "2.0" || !rpcRequest.method || rpcRequest.id == null) {
        return c.json(this.rpcError(rpcRequest.id ?? null, -32600, "Invalid Request"), 200);
      }

      // Check method
      const expectedType = METHOD_MAP[rpcRequest.method];
      if (!expectedType) {
        return c.json(
          this.rpcError(rpcRequest.id, -32601, `Method not found: ${rpcRequest.method}`),
          200,
        );
      }

      // Parse and validate the protocol message
      let message: ProtocolMessage;
      try {
        message = parseMessage(rpcRequest.params);
      } catch (err) {
        return c.json(
          this.rpcError(rpcRequest.id, -32602, `Invalid params: ${err instanceof Error ? err.message : String(err)}`),
          200,
        );
      }

      // Verify that the payload type matches the method
      if (message.payload.type !== expectedType) {
        return c.json(
          this.rpcError(
            rpcRequest.id,
            -32602,
            `Payload type "${message.payload.type}" does not match method "${rpcRequest.method}"`,
          ),
          200,
        );
      }

      // Verify message signature
      if (!verifyMessage(message)) {
        return c.json(
          this.rpcError(rpcRequest.id, -32003, "Invalid message signature"),
          200,
        );
      }

      // Route to handler
      try {
        await this.router.route(message);
      } catch (err) {
        return c.json(
          this.rpcError(rpcRequest.id, -32000, `Handler error: ${err instanceof Error ? err.message : String(err)}`),
          200,
        );
      }

      return c.json(this.rpcSuccess(rpcRequest.id, { status: "ok", messageId: message.id }), 200);
    });
  }

  /** Start the server */
  listen(port: number, hostname?: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port, hostname }, () => resolve());
    });
  }

  /** Stop the server */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private rpcSuccess(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", result, id: id ?? 0 };
  }

  private rpcError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", error: { code, message, data }, id: id ?? 0 };
  }
}
