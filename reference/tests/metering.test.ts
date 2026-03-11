import { describe, it, expect, beforeEach } from "vitest";
import { ulid } from "ulid";
import {
  MeteringTracker,
  validateMeteringReport,
  QuotaConsumptionTracker,
} from "../src/metering/tracker.js";
import type { MeteringReport } from "../src/types/exchange.js";

// ── MeteringTracker ──

describe("MeteringTracker", () => {
  let tracker: MeteringTracker;

  beforeEach(() => {
    tracker = new MeteringTracker();
  });

  it("starts a session and tracks usage", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    expect(tracker.isActive(contractId)).toBe(true);
    expect(tracker.activeCount).toBe(1);

    const usage = tracker.getUsage(contractId);
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(0);
  });

  it("records incremental usage", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    tracker.recordUsage(contractId, { inputTokens: 1000, outputTokens: 500 });
    tracker.recordUsage(contractId, { inputTokens: 2000, outputTokens: 1000, toolCalls: 3 });

    const usage = tracker.getUsage(contractId);
    expect(usage!.inputTokens).toBe(3000);
    expect(usage!.outputTokens).toBe(1500);
    expect(usage!.toolCalls).toBe(3);
  });

  it("generates interim reports", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    tracker.recordUsage(contractId, { inputTokens: 5000, outputTokens: 2000, wallClockMs: 30000 });

    const report = tracker.generateReport(contractId);

    expect(report.usage.inputTokens).toBe(5000);
    expect(report.usage.outputTokens).toBe(2000);
    expect(report.usage.totalTokens).toBe(7000);
    expect(report.usage.wallClockMs).toBe(30000);
    expect(report.worker).toBe("did:key:z6MkWorker");

    // Session still active after interim report
    expect(tracker.isActive(contractId)).toBe(true);
  });

  it("generates reports with cost calculator", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    tracker.recordUsage(contractId, { inputTokens: 10000, outputTokens: 5000 });

    const report = tracker.generateReport(contractId, (counters) => ({
      creditsConsumed: counters.inputTokens * 0.01 + counters.outputTokens * 0.03,
      breakdown: [
        { category: "input", amount: counters.inputTokens * 0.01 },
        { category: "output", amount: counters.outputTokens * 0.03 },
      ],
    }));

    expect(report.cost.creditsConsumed).toBe(250); // 100 + 150
    expect(report.cost.breakdown).toHaveLength(2);
  });

  it("finalizes a session", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    tracker.recordUsage(contractId, { inputTokens: 1000 });

    const finalReport = tracker.finalize(contractId);
    expect(finalReport.usage.inputTokens).toBe(1000);
    expect(tracker.isActive(contractId)).toBe(false);
  });

  it("rejects usage recording after finalization", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");
    tracker.finalize(contractId);

    expect(() => tracker.recordUsage(contractId, { inputTokens: 100 })).toThrow("finalized");
  });

  it("rejects report generation after finalization", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");
    tracker.finalize(contractId);

    expect(() => tracker.generateReport(contractId)).toThrow("finalized");
  });

  it("rejects duplicate session start", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    expect(() => tracker.startSession(contractId, ulid(), "did:key:z6MkWorker")).toThrow(
      "already exists",
    );
  });

  it("tracks multiple sessions", () => {
    const c1 = ulid();
    const c2 = ulid();
    tracker.startSession(c1, ulid(), "did:key:z6MkW1");
    tracker.startSession(c2, ulid(), "did:key:z6MkW2");

    tracker.recordUsage(c1, { inputTokens: 100 });
    tracker.recordUsage(c2, { inputTokens: 200 });

    expect(tracker.getUsage(c1)!.inputTokens).toBe(100);
    expect(tracker.getUsage(c2)!.inputTokens).toBe(200);
    expect(tracker.activeCount).toBe(2);

    tracker.finalize(c1);
    expect(tracker.activeCount).toBe(1);
  });

  it("returns all reports for a session", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");

    tracker.recordUsage(contractId, { inputTokens: 1000 });
    tracker.generateReport(contractId);

    tracker.recordUsage(contractId, { inputTokens: 2000 });
    tracker.generateReport(contractId);

    tracker.finalize(contractId);

    const reports = tracker.getReports(contractId);
    expect(reports).toHaveLength(3); // 2 interim + 1 final
  });

  it("returns null usage for unknown contract", () => {
    expect(tracker.getUsage("nonexistent")).toBeNull();
  });

  it("removes sessions", () => {
    const contractId = ulid();
    tracker.startSession(contractId, ulid(), "did:key:z6MkWorker");
    expect(tracker.activeCount).toBe(1);

    tracker.remove(contractId);
    expect(tracker.activeCount).toBe(0);
    expect(tracker.getUsage(contractId)).toBeNull();
  });
});

// ── validateMeteringReport ──

describe("validateMeteringReport", () => {
  function makeReport(overrides: Partial<{
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    wallClockMs: number;
    creditsConsumed: number;
    periodStart: string;
    periodEnd: string;
  }> = {}): MeteringReport {
    const inputTokens = overrides.inputTokens ?? 5000;
    const outputTokens = overrides.outputTokens ?? 2000;
    return {
      id: ulid(),
      contractId: ulid() as any,
      taskId: ulid() as any,
      worker: "did:key:z6MkWorker" as any,
      period: {
        start: overrides.periodStart ?? "2026-03-11T14:00:00.000Z",
        end: overrides.periodEnd ?? "2026-03-11T14:30:00.000Z",
      },
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: overrides.totalTokens ?? inputTokens + outputTokens,
        wallClockMs: overrides.wallClockMs ?? 180000,
      },
      cost: { creditsConsumed: overrides.creditsConsumed ?? 100 },
      signature: "sig",
    };
  }

  it("validates a correct report", () => {
    const result = validateMeteringReport(makeReport());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("flags token limit exceeded", () => {
    const result = validateMeteringReport(makeReport({ inputTokens: 90000, outputTokens: 20000 }), {
      maxTokens: 100000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("flags duration limit exceeded", () => {
    const result = validateMeteringReport(makeReport({ wallClockMs: 500000 }), {
      maxDurationMs: 300000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("flags credit limit exceeded", () => {
    const result = validateMeteringReport(makeReport({ creditsConsumed: 2000 }), {
      maxCredits: 1000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("warns on token total mismatch", () => {
    const result = validateMeteringReport(makeReport({ totalTokens: 999 }));
    expect(result.valid).toBe(true); // Warning, not error
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("doesn't equal");
  });

  it("errors on period end before start", () => {
    const result = validateMeteringReport(
      makeReport({
        periodStart: "2026-03-11T15:00:00.000Z",
        periodEnd: "2026-03-11T14:00:00.000Z",
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("end is before start");
  });

  it("warns on hourly quota exceeded", () => {
    const result = validateMeteringReport(
      makeReport({ inputTokens: 60000, outputTokens: 50000 }),
      { quotas: { maxTokensPerHour: 100000 } },
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("hourly quota");
  });

  it("passes with all limits satisfied", () => {
    const result = validateMeteringReport(makeReport(), {
      maxTokens: 100000,
      maxDurationMs: 600000,
      maxCredits: 1000,
    });
    expect(result.valid).toBe(true);
  });
});

// ── QuotaConsumptionTracker ──

describe("QuotaConsumptionTracker", () => {
  let qct: QuotaConsumptionTracker;
  const now = new Date("2026-03-11T14:30:00Z");

  beforeEach(() => {
    qct = new QuotaConsumptionTracker();
  });

  it("tracks token consumption and checks hourly quota", () => {
    qct.recordTokens("did:key:z6MkAgent", 50000, now);
    qct.recordTokens("did:key:z6MkAgent", 30000, now);

    const result = qct.checkQuota("did:key:z6MkAgent", { maxTokensPerHour: 100000 }, now);
    expect(result.allowed).toBe(true);
    expect(result.remaining.tokensThisHour).toBe(20000);
  });

  it("blocks when hourly token quota exceeded", () => {
    qct.recordTokens("did:key:z6MkAgent", 100000, now);

    const result = qct.checkQuota("did:key:z6MkAgent", { maxTokensPerHour: 100000 }, now);
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("Hourly token limit");
  });

  it("tracks task count and checks daily quota", () => {
    qct.recordTask("did:key:z6MkAgent", now);
    qct.recordTask("did:key:z6MkAgent", now);
    qct.recordTask("did:key:z6MkAgent", now);

    const result = qct.checkQuota("did:key:z6MkAgent", { maxTasksPerDay: 5 }, now);
    expect(result.allowed).toBe(true);
    expect(result.remaining.tasksThisDay).toBe(2);
  });

  it("blocks when daily task quota exceeded", () => {
    for (let i = 0; i < 10; i++) {
      qct.recordTask("did:key:z6MkAgent", now);
    }

    const result = qct.checkQuota("did:key:z6MkAgent", { maxTasksPerDay: 10 }, now);
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("Daily task limit");
  });

  it("tracks agents independently", () => {
    qct.recordTokens("did:key:z6MkA", 50000, now);
    qct.recordTokens("did:key:z6MkB", 90000, now);

    const resultA = qct.checkQuota("did:key:z6MkA", { maxTokensPerHour: 100000 }, now);
    const resultB = qct.checkQuota("did:key:z6MkB", { maxTokensPerHour: 100000 }, now);

    expect(resultA.allowed).toBe(true);
    expect(resultB.allowed).toBe(true);
    expect(resultA.remaining.tokensThisHour).toBe(50000);
    expect(resultB.remaining.tokensThisHour).toBe(10000);
  });

  it("allows if no quotas set", () => {
    qct.recordTokens("did:key:z6MkAgent", 999999, now);
    qct.recordTask("did:key:z6MkAgent", now);

    const result = qct.checkQuota("did:key:z6MkAgent", {}, now);
    expect(result.allowed).toBe(true);
  });

  it("different hours have separate counters", () => {
    const hour1 = new Date("2026-03-11T14:00:00Z");
    const hour2 = new Date("2026-03-11T15:00:00Z");

    qct.recordTokens("did:key:z6MkAgent", 80000, hour1);

    // Same day, different hour
    const result = qct.checkQuota("did:key:z6MkAgent", { maxTokensPerHour: 100000 }, hour2);
    expect(result.allowed).toBe(true);
    expect(result.remaining.tokensThisHour).toBe(100000);
  });

  it("same day accumulates for daily quota", () => {
    const hour1 = new Date("2026-03-11T14:00:00Z");
    const hour2 = new Date("2026-03-11T15:00:00Z");

    qct.recordTokens("did:key:z6MkAgent", 500000, hour1);
    qct.recordTokens("did:key:z6MkAgent", 300000, hour2);

    const result = qct.checkQuota("did:key:z6MkAgent", { maxTokensPerDay: 1000000 }, hour2);
    expect(result.allowed).toBe(true);
    expect(result.remaining.tokensThisDay).toBe(200000);
  });

  it("reports multiple violations at once", () => {
    for (let i = 0; i < 20; i++) {
      qct.recordTask("did:key:z6MkAgent", now);
    }
    qct.recordTokens("did:key:z6MkAgent", 200000, now);

    const result = qct.checkQuota("did:key:z6MkAgent", {
      maxTasksPerHour: 10,
      maxTasksPerDay: 15,
      maxTokensPerHour: 100000,
    }, now);

    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});
