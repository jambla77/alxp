/**
 * Async task support via webhooks and Server-Sent Events (SSE).
 *
 * For long-running tasks, agents need:
 * - Webhooks: push notifications for state changes
 * - SSE: streaming partial results and progress updates
 * - Heartbeats: periodic "still alive" signals
 *
 * This module provides both the sender (notification publisher)
 * and receiver (webhook endpoint) sides.
 */

import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import type { DID } from "../types/index.js";

/** A webhook notification */
export interface WebhookNotification {
  /** Type of notification */
  type: "state_change" | "progress" | "heartbeat" | "result_ready" | "error";
  /** Contract this notification is about */
  contractId: string;
  /** Task ID */
  taskId: string;
  /** The notification data */
  data: {
    /** New state (for state_change) */
    state?: string;
    /** Previous state (for state_change) */
    previousState?: string;
    /** Progress percentage 0-100 (for progress) */
    progress?: number;
    /** Status message */
    message?: string;
    /** Error details (for error) */
    error?: string;
  };
  /** Timestamp */
  timestamp: string;
  /** Sender DID */
  sender: DID;
  /** Signature over the notification */
  signature: string;
}

/** Registered webhook callback */
interface WebhookRegistration {
  contractId: string;
  callbackUrl: string;
  events: WebhookNotification["type"][];
}

/**
 * Webhook sender — publishes notifications to registered callbacks.
 */
export class WebhookPublisher {
  private registrations = new Map<string, WebhookRegistration[]>();

  /** Register a callback URL for a contract's events */
  register(contractId: string, callbackUrl: string, events?: WebhookNotification["type"][]): void {
    const existing = this.registrations.get(contractId) ?? [];
    existing.push({
      contractId,
      callbackUrl,
      events: events ?? ["state_change", "progress", "heartbeat", "result_ready", "error"],
    });
    this.registrations.set(contractId, existing);
  }

  /** Unregister all callbacks for a contract */
  unregister(contractId: string): void {
    this.registrations.delete(contractId);
  }

  /**
   * Send a notification to all registered callbacks for a contract.
   * Returns the number of callbacks that received the notification.
   */
  async notify(notification: WebhookNotification): Promise<number> {
    const regs = this.registrations.get(notification.contractId) ?? [];
    let sent = 0;

    for (const reg of regs) {
      // Skip if this event type isn't subscribed
      if (!reg.events.includes(notification.type)) continue;

      try {
        const response = await fetch(reg.callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notification),
        });

        if (response.ok) sent++;
      } catch {
        // Failed to deliver — in production, implement retry logic
      }
    }

    return sent;
  }

  /** Get all registrations for a contract */
  getRegistrations(contractId: string): WebhookRegistration[] {
    return [...(this.registrations.get(contractId) ?? [])];
  }
}

/** Handler called when a webhook notification is received */
export type WebhookHandler = (notification: WebhookNotification) => Promise<void>;

/**
 * Webhook receiver — listens for incoming notifications.
 */
export class WebhookReceiver {
  readonly app: Hono;
  private server: ServerType | null = null;
  private handlers: WebhookHandler[] = [];
  readonly received: WebhookNotification[] = [];

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.post("/webhook", async (c) => {
      let notification: WebhookNotification;
      try {
        notification = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }

      this.received.push(notification);

      for (const handler of this.handlers) {
        try {
          await handler(notification);
        } catch {
          // Handler error — don't fail the webhook delivery
        }
      }

      return c.json({ status: "ok" }, 200);
    });
  }

  /** Register a handler for incoming notifications */
  onNotification(handler: WebhookHandler): void {
    this.handlers.push(handler);
  }

  /** Start listening */
  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({ fetch: this.app.fetch, port }, () => resolve());
    });
  }

  /** Stop listening */
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

/**
 * SSE stream for real-time progress updates.
 *
 * Workers can stream progress to requesters via Server-Sent Events.
 * The Hono SSE helper is used on the server side.
 */
export class ProgressStream {
  private listeners = new Map<string, ((event: string, data: string) => void)[]>();

  /** Register a listener for a contract's progress events */
  subscribe(contractId: string, listener: (event: string, data: string) => void): () => void {
    const existing = this.listeners.get(contractId) ?? [];
    existing.push(listener);
    this.listeners.set(contractId, existing);

    // Return unsubscribe function
    return () => {
      const list = this.listeners.get(contractId) ?? [];
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Emit a progress event to all listeners for a contract */
  emit(contractId: string, event: string, data: Record<string, unknown>): void {
    const list = this.listeners.get(contractId) ?? [];
    const serialized = JSON.stringify(data);
    for (const listener of list) {
      listener(event, serialized);
    }
  }

  /** Emit a progress percentage update */
  progress(contractId: string, percent: number, message?: string): void {
    this.emit(contractId, "progress", { percent, message, timestamp: new Date().toISOString() });
  }

  /** Emit a heartbeat */
  heartbeat(contractId: string): void {
    this.emit(contractId, "heartbeat", { timestamp: new Date().toISOString() });
  }

  /** Emit a completion event */
  complete(contractId: string): void {
    this.emit(contractId, "complete", { timestamp: new Date().toISOString() });
  }

  /** Emit an error event */
  error(contractId: string, error: string): void {
    this.emit(contractId, "error", { error, timestamp: new Date().toISOString() });
  }
}
