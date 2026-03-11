/**
 * Heartbeat Tracker — monitors agent liveness and manages availability state.
 *
 * Agents send periodic HEARTBEAT messages to signal they're online.
 * The tracker maintains last-seen timestamps and detects stale agents
 * that have stopped heartbeating.
 *
 * Also provides schedule-aware availability checking — determines if an
 * agent is currently within their declared availability windows.
 */

import type { DID, AvailabilityWindow } from "../types/index.js";
import type { Heartbeat } from "../types/message.js";
import type { QuotaRemaining } from "../types/exchange.js";

/** Heartbeat state for a single agent */
export interface HeartbeatState {
  agentId: DID;
  status: "online" | "busy" | "offline";
  capacity: number;
  currentTasks: number;
  quotaRemaining?: QuotaRemaining;
  lastHeartbeat: Date;
  missedHeartbeats: number;
}

/** Options for the heartbeat tracker */
export interface HeartbeatTrackerOptions {
  /** How long before an agent is considered stale (ms). Default: 60000 (60s) */
  staleTimeout?: number;
  /** How often to run the staleness sweep (ms). Default: 15000 (15s) */
  sweepInterval?: number;
}

/** Callback when an agent's status changes due to heartbeat tracking */
export type HeartbeatCallback = (agentId: DID, event: "online" | "stale" | "offline" | "recovered") => void;

/**
 * Tracks agent heartbeats and detects stale/offline agents.
 */
export class HeartbeatTracker {
  private states = new Map<string, HeartbeatState>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: HeartbeatCallback[] = [];

  readonly staleTimeout: number;
  readonly sweepInterval: number;

  constructor(options: HeartbeatTrackerOptions = {}) {
    this.staleTimeout = options.staleTimeout ?? 60_000;
    this.sweepInterval = options.sweepInterval ?? 15_000;
  }

  /** Register a callback for heartbeat status changes */
  onStatusChange(callback: HeartbeatCallback): void {
    this.callbacks.push(callback);
  }

  /** Process an incoming heartbeat from an agent */
  recordHeartbeat(heartbeat: Heartbeat): HeartbeatState {
    const existing = this.states.get(heartbeat.agentId);
    const wasStale = existing && this.isStale(existing);

    const state: HeartbeatState = {
      agentId: heartbeat.agentId as DID,
      status: heartbeat.status,
      capacity: heartbeat.capacity,
      currentTasks: heartbeat.currentTasks,
      quotaRemaining: heartbeat.quotaRemaining,
      lastHeartbeat: new Date(),
      missedHeartbeats: 0,
    };

    this.states.set(heartbeat.agentId, state);

    // Emit events
    if (!existing) {
      this.emit(heartbeat.agentId as DID, "online");
    } else if (wasStale) {
      this.emit(heartbeat.agentId as DID, "recovered");
    }

    if (heartbeat.status === "offline") {
      this.emit(heartbeat.agentId as DID, "offline");
    }

    return state;
  }

  /** Get the heartbeat state for an agent */
  getState(agentId: string): HeartbeatState | null {
    return this.states.get(agentId) ?? null;
  }

  /** Check if an agent's heartbeat is stale */
  isStale(state: HeartbeatState): boolean {
    const age = Date.now() - state.lastHeartbeat.getTime();
    return age > this.staleTimeout;
  }

  /** Check if an agent is currently alive (heartbeating and not stale) */
  isAlive(agentId: string): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;
    if (state.status === "offline") return false;
    return !this.isStale(state);
  }

  /** Get all agents that are currently alive */
  getAliveAgents(): HeartbeatState[] {
    return [...this.states.values()].filter(
      (s) => s.status !== "offline" && !this.isStale(s),
    );
  }

  /** Get all agents that are stale (haven't heartbeated recently) */
  getStaleAgents(): HeartbeatState[] {
    return [...this.states.values()].filter(
      (s) => s.status !== "offline" && this.isStale(s),
    );
  }

  /** Run a single staleness sweep and emit events for newly stale agents */
  sweep(): DID[] {
    const newlyStale: DID[] = [];

    for (const state of this.states.values()) {
      if (state.status === "offline") continue;
      if (this.isStale(state) && state.missedHeartbeats === 0) {
        state.missedHeartbeats++;
        newlyStale.push(state.agentId);
        this.emit(state.agentId, "stale");
      }
    }

    return newlyStale;
  }

  /** Start automatic periodic sweeps */
  startSweeping(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepInterval);
  }

  /** Stop automatic periodic sweeps */
  stopSweeping(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Remove an agent from tracking */
  remove(agentId: string): boolean {
    return this.states.delete(agentId);
  }

  /** Number of tracked agents */
  get size(): number {
    return this.states.size;
  }

  private emit(agentId: DID, event: "online" | "stale" | "offline" | "recovered"): void {
    for (const cb of this.callbacks) {
      cb(agentId, event);
    }
  }
}

// ── Schedule-Aware Availability ──

/**
 * Check if a given time falls within an availability window.
 */
export function isWithinWindow(window: AvailabilityWindow, now: Date = new Date()): boolean {
  // Check day of week (empty array means every day)
  if (window.dayOfWeek.length > 0) {
    const day = now.getUTCDay();
    if (!window.dayOfWeek.includes(day)) return false;
  }

  // Parse HH:MM times and compare in UTC (or specified timezone)
  // For simplicity, we compare in UTC. Timezone conversion is a platform concern.
  const [startH, startM] = window.startTime.split(":").map(Number) as [number, number];
  const [endH, endM] = window.endTime.split(":").map(Number) as [number, number];

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle overnight windows (e.g., 22:00 - 06:00)
  if (endMinutes <= startMinutes) {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

/**
 * Check if an agent is currently within any of their availability windows.
 * Returns the capacity for the matching window, or null if outside all windows.
 *
 * If the agent has no schedule, they're assumed to be always available.
 */
export function getScheduledCapacity(
  schedule: AvailabilityWindow[] | undefined,
  now: Date = new Date(),
): number | null {
  if (!schedule || schedule.length === 0) return null; // No schedule = always available

  for (const window of schedule) {
    if (isWithinWindow(window, now)) {
      return window.capacity;
    }
  }

  return 0; // Outside all windows = not available
}

// ── Quota Checking ──

/**
 * Check if an agent has remaining quota based on their heartbeat state.
 * Returns true if the agent has capacity for at least one more task.
 */
export function hasRemainingQuota(state: HeartbeatState): boolean {
  if (!state.quotaRemaining) return true; // No quota info = assume available

  const qr = state.quotaRemaining;

  // Check if any quota is exhausted
  if (qr.tasksThisHour !== undefined && qr.tasksThisHour <= 0) return false;
  if (qr.tasksThisDay !== undefined && qr.tasksThisDay <= 0) return false;
  if (qr.tokensThisHour !== undefined && qr.tokensThisHour <= 0) return false;
  if (qr.tokensThisDay !== undefined && qr.tokensThisDay <= 0) return false;

  return true;
}
