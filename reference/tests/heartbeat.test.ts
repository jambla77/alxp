import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HeartbeatTracker,
  isWithinWindow,
  getScheduledCapacity,
  hasRemainingQuota,
} from "../src/discovery/heartbeat.js";
import type { Heartbeat } from "../src/types/message.js";
import type { AvailabilityWindow } from "../src/types/primitives.js";
import type { HeartbeatState } from "../src/discovery/heartbeat.js";

function makeHeartbeat(
  agentId: string,
  status: "online" | "busy" | "offline" = "online",
  capacity = 0.8,
  currentTasks = 0,
): Heartbeat {
  return {
    type: "HEARTBEAT" as const,
    agentId: agentId as any,
    status,
    capacity,
    currentTasks,
  };
}

// ── HeartbeatTracker ──

describe("HeartbeatTracker", () => {
  let tracker: HeartbeatTracker;

  beforeEach(() => {
    tracker = new HeartbeatTracker({ staleTimeout: 1000, sweepInterval: 500 });
  });

  afterEach(() => {
    tracker.stopSweeping();
  });

  it("records a heartbeat and tracks state", () => {
    const state = tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    expect(state.agentId).toBe("did:key:z6MkAgent1");
    expect(state.status).toBe("online");
    expect(state.capacity).toBe(0.8);
    expect(state.currentTasks).toBe(0);
    expect(state.missedHeartbeats).toBe(0);
    expect(tracker.size).toBe(1);
  });

  it("retrieves state by agent ID", () => {
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    const state = tracker.getState("did:key:z6MkAgent1");
    expect(state).not.toBeNull();
    expect(state!.status).toBe("online");

    expect(tracker.getState("did:key:z6MkUnknown")).toBeNull();
  });

  it("updates state on subsequent heartbeats", () => {
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1", "online", 0.8, 0));
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1", "busy", 0.3, 2));

    const state = tracker.getState("did:key:z6MkAgent1");
    expect(state!.status).toBe("busy");
    expect(state!.capacity).toBe(0.3);
    expect(state!.currentTasks).toBe(2);
    expect(tracker.size).toBe(1); // Still one agent
  });

  it("detects alive agents", () => {
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    expect(tracker.isAlive("did:key:z6MkAgent1")).toBe(true);
    expect(tracker.isAlive("did:key:z6MkUnknown")).toBe(false);
  });

  it("detects offline agents as not alive", () => {
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1", "offline"));
    expect(tracker.isAlive("did:key:z6MkAgent1")).toBe(false);
  });

  it("detects stale agents after timeout", async () => {
    // Use a very short timeout
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    expect(shortTracker.isAlive("did:key:z6MkAgent1")).toBe(true);

    // Wait for staleness
    await new Promise((r) => setTimeout(r, 100));

    expect(shortTracker.isAlive("did:key:z6MkAgent1")).toBe(false);
    expect(shortTracker.getStaleAgents()).toHaveLength(1);
  });

  it("sweep detects newly stale agents", async () => {
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent2"));

    await new Promise((r) => setTimeout(r, 100));

    const stale = shortTracker.sweep();
    expect(stale).toHaveLength(2);
    expect(stale).toContain("did:key:z6MkAgent1");
    expect(stale).toContain("did:key:z6MkAgent2");
  });

  it("sweep does not re-emit for already-stale agents", async () => {
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    await new Promise((r) => setTimeout(r, 100));

    const first = shortTracker.sweep();
    expect(first).toHaveLength(1);

    const second = shortTracker.sweep();
    expect(second).toHaveLength(0); // Already emitted
  });

  it("recovery resets staleness on new heartbeat", async () => {
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));

    await new Promise((r) => setTimeout(r, 100));
    expect(shortTracker.isAlive("did:key:z6MkAgent1")).toBe(false);

    // Agent recovers with a new heartbeat
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    expect(shortTracker.isAlive("did:key:z6MkAgent1")).toBe(true);
    expect(shortTracker.getState("did:key:z6MkAgent1")!.missedHeartbeats).toBe(0);
  });

  it("emits status change callbacks", () => {
    const events: [string, string][] = [];
    tracker.onStatusChange((agentId, event) => {
      events.push([agentId, event]);
    });

    // First heartbeat = online
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    expect(events).toEqual([["did:key:z6MkAgent1", "online"]]);

    // Offline heartbeat
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1", "offline"));
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(["did:key:z6MkAgent1", "offline"]);
  });

  it("emits stale and recovered events", async () => {
    const events: [string, string][] = [];
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });
    shortTracker.onStatusChange((agentId, event) => {
      events.push([agentId, event]);
    });

    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    // ["did:key:z6MkAgent1", "online"]

    await new Promise((r) => setTimeout(r, 100));
    shortTracker.sweep();
    // ["did:key:z6MkAgent1", "stale"]

    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    // ["did:key:z6MkAgent1", "recovered"]

    expect(events.map(([, e]) => e)).toEqual(["online", "stale", "recovered"]);
  });

  it("getAliveAgents returns only non-stale, non-offline agents", async () => {
    const shortTracker = new HeartbeatTracker({ staleTimeout: 50 });

    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAlive", "online"));
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkOffline", "offline"));

    expect(shortTracker.getAliveAgents()).toHaveLength(1);
    expect(shortTracker.getAliveAgents()[0]!.agentId).toBe("did:key:z6MkAlive");

    // Wait for staleness
    await new Promise((r) => setTimeout(r, 100));
    shortTracker.recordHeartbeat(makeHeartbeat("did:key:z6MkFresh", "online"));

    const alive = shortTracker.getAliveAgents();
    expect(alive).toHaveLength(1);
    expect(alive[0]!.agentId).toBe("did:key:z6MkFresh");
  });

  it("removes agents from tracking", () => {
    tracker.recordHeartbeat(makeHeartbeat("did:key:z6MkAgent1"));
    expect(tracker.size).toBe(1);

    tracker.remove("did:key:z6MkAgent1");
    expect(tracker.size).toBe(0);
    expect(tracker.getState("did:key:z6MkAgent1")).toBeNull();
  });

  it("tracks quota remaining from heartbeats", () => {
    const hb = makeHeartbeat("did:key:z6MkAgent1");
    (hb as any).quotaRemaining = {
      tokensThisHour: 80000,
      tokensThisDay: 4500000,
      tasksThisHour: 8,
      tasksThisDay: 45,
    };

    const state = tracker.recordHeartbeat(hb);
    expect(state.quotaRemaining?.tokensThisHour).toBe(80000);
    expect(state.quotaRemaining?.tasksThisDay).toBe(45);
  });
});

// ── isWithinWindow ──

describe("isWithinWindow", () => {
  it("matches when time is within window", () => {
    const window: AvailabilityWindow = {
      dayOfWeek: [],
      startTime: "09:00",
      endTime: "17:00",
      capacity: 1,
    };

    // 12:00 UTC on any day
    const noon = new Date("2026-03-11T12:00:00Z");
    expect(isWithinWindow(window, noon)).toBe(true);
  });

  it("rejects when time is outside window", () => {
    const window: AvailabilityWindow = {
      dayOfWeek: [],
      startTime: "09:00",
      endTime: "17:00",
      capacity: 1,
    };

    const earlyMorning = new Date("2026-03-11T06:00:00Z");
    expect(isWithinWindow(window, earlyMorning)).toBe(false);

    const lateNight = new Date("2026-03-11T23:00:00Z");
    expect(isWithinWindow(window, lateNight)).toBe(false);
  });

  it("checks day of week", () => {
    const weekdayWindow: AvailabilityWindow = {
      dayOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
      startTime: "09:00",
      endTime: "17:00",
      capacity: 1,
    };

    // 2026-03-11 is a Wednesday (day 3)
    const wednesday = new Date("2026-03-11T12:00:00Z");
    expect(isWithinWindow(weekdayWindow, wednesday)).toBe(true);

    // 2026-03-15 is a Sunday (day 0)
    const sunday = new Date("2026-03-15T12:00:00Z");
    expect(isWithinWindow(weekdayWindow, sunday)).toBe(false);
  });

  it("handles overnight windows", () => {
    const overnightWindow: AvailabilityWindow = {
      dayOfWeek: [],
      startTime: "22:00",
      endTime: "06:00",
      capacity: 0.5,
    };

    const midnight = new Date("2026-03-11T00:00:00Z");
    expect(isWithinWindow(overnightWindow, midnight)).toBe(true);

    const lateNight = new Date("2026-03-11T23:00:00Z");
    expect(isWithinWindow(overnightWindow, lateNight)).toBe(true);

    const afternoon = new Date("2026-03-11T14:00:00Z");
    expect(isWithinWindow(overnightWindow, afternoon)).toBe(false);
  });

  it("empty dayOfWeek means every day", () => {
    const window: AvailabilityWindow = {
      dayOfWeek: [],
      startTime: "00:00",
      endTime: "23:59",
      capacity: 1,
    };

    // Should match any day
    for (let d = 8; d <= 14; d++) {
      const day = String(d).padStart(2, "0");
      expect(isWithinWindow(window, new Date(`2026-03-${day}T12:00:00Z`))).toBe(true);
    }
  });
});

// ── getScheduledCapacity ──

describe("getScheduledCapacity", () => {
  it("returns null for agents with no schedule (always available)", () => {
    expect(getScheduledCapacity(undefined)).toBeNull();
    expect(getScheduledCapacity([])).toBeNull();
  });

  it("returns matching window capacity", () => {
    const schedule: AvailabilityWindow[] = [
      { dayOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", capacity: 0.8 },
      { dayOfWeek: [0, 6], startTime: "12:00", endTime: "18:00", capacity: 0.3 },
    ];

    // Wednesday noon
    const wednesday = new Date("2026-03-11T12:00:00Z");
    expect(getScheduledCapacity(schedule, wednesday)).toBe(0.8);

    // Sunday noon
    const sunday = new Date("2026-03-15T12:00:00Z");
    expect(getScheduledCapacity(schedule, sunday)).toBe(0.3);
  });

  it("returns 0 when outside all windows", () => {
    const schedule: AvailabilityWindow[] = [
      { dayOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", capacity: 0.8 },
    ];

    // Wednesday 2am — outside all windows
    const earlyMorning = new Date("2026-03-11T02:00:00Z");
    expect(getScheduledCapacity(schedule, earlyMorning)).toBe(0);

    // Sunday noon — wrong day
    const sunday = new Date("2026-03-15T12:00:00Z");
    expect(getScheduledCapacity(schedule, sunday)).toBe(0);
  });
});

// ── hasRemainingQuota ──

describe("hasRemainingQuota", () => {
  const baseState: HeartbeatState = {
    agentId: "did:key:z6MkAgent1" as any,
    status: "online",
    capacity: 0.8,
    currentTasks: 0,
    lastHeartbeat: new Date(),
    missedHeartbeats: 0,
  };

  it("returns true when no quota info", () => {
    expect(hasRemainingQuota(baseState)).toBe(true);
  });

  it("returns true when all quotas have remaining capacity", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: {
          tokensThisHour: 50000,
          tokensThisDay: 4000000,
          tasksThisHour: 8,
          tasksThisDay: 40,
        },
      }),
    ).toBe(true);
  });

  it("returns false when tasks per hour exhausted", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: { tasksThisHour: 0 },
      }),
    ).toBe(false);
  });

  it("returns false when tasks per day exhausted", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: { tasksThisDay: 0 },
      }),
    ).toBe(false);
  });

  it("returns false when tokens per hour exhausted", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: { tokensThisHour: 0 },
      }),
    ).toBe(false);
  });

  it("returns false when tokens per day exhausted", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: { tokensThisDay: 0 },
      }),
    ).toBe(false);
  });

  it("returns true when some quotas undefined", () => {
    expect(
      hasRemainingQuota({
        ...baseState,
        quotaRemaining: { tasksThisHour: 5 },
      }),
    ).toBe(true);
  });
});
