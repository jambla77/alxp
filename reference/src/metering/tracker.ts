/**
 * Metering Tracker — records and validates resource consumption during task execution.
 *
 * Workers use the MeteringTracker to record usage as they work on a task.
 * It can generate interim and final MeteringReports, and validate that
 * reported usage is within expected bounds (budget, quotas).
 */

import { ulid } from "ulid";
import type { DID } from "../types/primitives.js";
import type { MeteringReport, UsageBreakdown } from "../types/exchange.js";
import type { AgentQuotas } from "../types/primitives.js";

/** Running usage counters for a single task */
export interface UsageCounters {
  inputTokens: number;
  outputTokens: number;
  wallClockMs: number;
  reasoningSteps: number;
  toolCalls: number;
  apiCalls: number;
}

/** A tracked metering session for a single contract */
interface MeteringSession {
  contractId: string;
  taskId: string;
  worker: string;
  startedAt: Date;
  counters: UsageCounters;
  reports: MeteringReport[];
  finalized: boolean;
}

/**
 * Tracks resource consumption across active task sessions.
 *
 * Usage:
 * 1. startSession(contractId, taskId, worker) — begin tracking
 * 2. recordUsage(contractId, ...) — add incremental usage
 * 3. generateReport(contractId) — create interim report
 * 4. finalize(contractId) — create final report and close session
 */
export class MeteringTracker {
  private sessions = new Map<string, MeteringSession>();

  /** Start a metering session for a contract */
  startSession(contractId: string, taskId: string, worker: string): void {
    if (this.sessions.has(contractId)) {
      throw new Error(`Session already exists for contract ${contractId}`);
    }

    this.sessions.set(contractId, {
      contractId,
      taskId,
      worker,
      startedAt: new Date(),
      counters: {
        inputTokens: 0,
        outputTokens: 0,
        wallClockMs: 0,
        reasoningSteps: 0,
        toolCalls: 0,
        apiCalls: 0,
      },
      reports: [],
      finalized: false,
    });
  }

  /** Record incremental usage for a contract */
  recordUsage(
    contractId: string,
    usage: Partial<UsageCounters>,
  ): UsageCounters {
    const session = this.getActiveSession(contractId);

    if (usage.inputTokens) session.counters.inputTokens += usage.inputTokens;
    if (usage.outputTokens) session.counters.outputTokens += usage.outputTokens;
    if (usage.wallClockMs) session.counters.wallClockMs += usage.wallClockMs;
    if (usage.reasoningSteps) session.counters.reasoningSteps += usage.reasoningSteps;
    if (usage.toolCalls) session.counters.toolCalls += usage.toolCalls;
    if (usage.apiCalls) session.counters.apiCalls += usage.apiCalls;

    return { ...session.counters };
  }

  /** Get current usage counters for a contract */
  getUsage(contractId: string): UsageCounters | null {
    const session = this.sessions.get(contractId);
    if (!session) return null;
    return { ...session.counters };
  }

  /**
   * Generate an interim metering report (does not close the session).
   * Optionally specify a credit cost calculator.
   */
  generateReport(
    contractId: string,
    costCalculator?: (counters: UsageCounters) => { creditsConsumed: number; breakdown?: UsageBreakdown[] },
  ): MeteringReport {
    const session = this.getActiveSession(contractId);
    const now = new Date();

    const cost = costCalculator
      ? costCalculator(session.counters)
      : { creditsConsumed: 0 };

    const report: MeteringReport = {
      id: ulid(),
      contractId: session.contractId as any,
      taskId: session.taskId as any,
      worker: session.worker as DID,
      period: {
        start: session.startedAt.toISOString(),
        end: now.toISOString(),
      },
      usage: {
        inputTokens: session.counters.inputTokens,
        outputTokens: session.counters.outputTokens,
        totalTokens: session.counters.inputTokens + session.counters.outputTokens,
        wallClockMs: session.counters.wallClockMs,
        reasoningSteps: session.counters.reasoningSteps || undefined,
        toolCalls: session.counters.toolCalls || undefined,
        apiCalls: session.counters.apiCalls || undefined,
      },
      cost: {
        creditsConsumed: cost.creditsConsumed,
        breakdown: cost.breakdown,
      },
      signature: `metering:${ulid()}`,
    };

    session.reports.push(report);
    return report;
  }

  /**
   * Finalize a session — generates the final report and closes the session.
   * No more usage can be recorded after finalization.
   */
  finalize(
    contractId: string,
    costCalculator?: (counters: UsageCounters) => { creditsConsumed: number; breakdown?: UsageBreakdown[] },
  ): MeteringReport {
    const session = this.getActiveSession(contractId);
    const report = this.generateReport(contractId, costCalculator);
    session.finalized = true;
    return report;
  }

  /** Get all reports for a contract */
  getReports(contractId: string): MeteringReport[] {
    const session = this.sessions.get(contractId);
    if (!session) return [];
    return [...session.reports];
  }

  /** Check if a session exists and is active */
  isActive(contractId: string): boolean {
    const session = this.sessions.get(contractId);
    return !!session && !session.finalized;
  }

  /** Remove a session from tracking */
  remove(contractId: string): boolean {
    return this.sessions.delete(contractId);
  }

  /** Number of active sessions */
  get activeCount(): number {
    return [...this.sessions.values()].filter((s) => !s.finalized).length;
  }

  private getActiveSession(contractId: string): MeteringSession {
    const session = this.sessions.get(contractId);
    if (!session) throw new Error(`No metering session for contract ${contractId}`);
    if (session.finalized) throw new Error(`Metering session for contract ${contractId} is finalized`);
    return session;
  }
}

// ── Metering Validation ──

/** Result of metering validation */
export interface MeteringValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate a metering report against expected bounds.
 */
export function validateMeteringReport(
  report: MeteringReport,
  options: MeteringValidationOptions = {},
): MeteringValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const { maxTokens, maxDurationMs, maxCredits, quotas } = options;

  // Check token limits
  if (maxTokens !== undefined && report.usage.totalTokens > maxTokens) {
    errors.push(
      `Total tokens ${report.usage.totalTokens} exceeds maximum ${maxTokens}`,
    );
  }

  // Check duration limits
  if (maxDurationMs !== undefined && report.usage.wallClockMs > maxDurationMs) {
    errors.push(
      `Wall clock time ${report.usage.wallClockMs}ms exceeds maximum ${maxDurationMs}ms`,
    );
  }

  // Check credit limits
  if (maxCredits !== undefined && report.cost.creditsConsumed > maxCredits) {
    errors.push(
      `Credits consumed ${report.cost.creditsConsumed} exceeds maximum ${maxCredits}`,
    );
  }

  // Check against agent quotas
  if (quotas) {
    if (quotas.maxTokensPerHour !== undefined) {
      // Rough check: if the report period is <= 1 hour and tokens exceed the hourly limit
      const periodMs = new Date(report.period.end).getTime() - new Date(report.period.start).getTime();
      if (periodMs <= 3_600_000 && report.usage.totalTokens > quotas.maxTokensPerHour) {
        warnings.push(
          `Tokens ${report.usage.totalTokens} exceeds hourly quota ${quotas.maxTokensPerHour}`,
        );
      }
    }
  }

  // Sanity checks
  if (report.usage.totalTokens !== report.usage.inputTokens + report.usage.outputTokens) {
    warnings.push(
      `Total tokens (${report.usage.totalTokens}) doesn't equal input + output (${report.usage.inputTokens + report.usage.outputTokens})`,
    );
  }

  if (report.usage.wallClockMs < 0) {
    errors.push("Wall clock time is negative");
  }

  const periodStart = new Date(report.period.start).getTime();
  const periodEnd = new Date(report.period.end).getTime();
  if (periodEnd < periodStart) {
    errors.push("Report period end is before start");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/** Options for metering validation */
export interface MeteringValidationOptions {
  /** Maximum total tokens allowed */
  maxTokens?: number;
  /** Maximum wall clock duration allowed (ms) */
  maxDurationMs?: number;
  /** Maximum credits allowed */
  maxCredits?: number;
  /** Agent quotas to check against */
  quotas?: AgentQuotas;
}

// ── Quota Consumption Tracker ──

/**
 * Tracks cumulative quota consumption across sessions for a single agent.
 * Used to enforce daily/hourly limits.
 */
export class QuotaConsumptionTracker {
  private hourlyTokens = new Map<string, number>(); // "agentId:hourKey" -> tokens
  private dailyTokens = new Map<string, number>();  // "agentId:dateKey" -> tokens
  private hourlyTasks = new Map<string, number>();
  private dailyTasks = new Map<string, number>();

  private hourKey(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  }

  private dateKey(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  }

  /** Record token consumption for an agent */
  recordTokens(agentId: string, tokens: number, now: Date = new Date()): void {
    const hk = `${agentId}:${this.hourKey(now)}`;
    const dk = `${agentId}:${this.dateKey(now)}`;
    this.hourlyTokens.set(hk, (this.hourlyTokens.get(hk) ?? 0) + tokens);
    this.dailyTokens.set(dk, (this.dailyTokens.get(dk) ?? 0) + tokens);
  }

  /** Record a task start for an agent */
  recordTask(agentId: string, now: Date = new Date()): void {
    const hk = `${agentId}:${this.hourKey(now)}`;
    const dk = `${agentId}:${this.dateKey(now)}`;
    this.hourlyTasks.set(hk, (this.hourlyTasks.get(hk) ?? 0) + 1);
    this.dailyTasks.set(dk, (this.dailyTasks.get(dk) ?? 0) + 1);
  }

  /** Check if an agent has remaining quota */
  checkQuota(agentId: string, quotas: AgentQuotas, now: Date = new Date()): QuotaCheckResult {
    const hk = `${agentId}:${this.hourKey(now)}`;
    const dk = `${agentId}:${this.dateKey(now)}`;

    const tokensThisHour = this.hourlyTokens.get(hk) ?? 0;
    const tokensThisDay = this.dailyTokens.get(dk) ?? 0;
    const tasksThisHour = this.hourlyTasks.get(hk) ?? 0;
    const tasksThisDay = this.dailyTasks.get(dk) ?? 0;

    const violations: string[] = [];

    if (quotas.maxTokensPerHour !== undefined && tokensThisHour >= quotas.maxTokensPerHour) {
      violations.push(`Hourly token limit reached: ${tokensThisHour}/${quotas.maxTokensPerHour}`);
    }
    if (quotas.maxTokensPerDay !== undefined && tokensThisDay >= quotas.maxTokensPerDay) {
      violations.push(`Daily token limit reached: ${tokensThisDay}/${quotas.maxTokensPerDay}`);
    }
    if (quotas.maxTasksPerHour !== undefined && tasksThisHour >= quotas.maxTasksPerHour) {
      violations.push(`Hourly task limit reached: ${tasksThisHour}/${quotas.maxTasksPerHour}`);
    }
    if (quotas.maxTasksPerDay !== undefined && tasksThisDay >= quotas.maxTasksPerDay) {
      violations.push(`Daily task limit reached: ${tasksThisDay}/${quotas.maxTasksPerDay}`);
    }

    return {
      allowed: violations.length === 0,
      violations,
      remaining: {
        tokensThisHour: quotas.maxTokensPerHour !== undefined
          ? Math.max(0, quotas.maxTokensPerHour - tokensThisHour) : undefined,
        tokensThisDay: quotas.maxTokensPerDay !== undefined
          ? Math.max(0, quotas.maxTokensPerDay - tokensThisDay) : undefined,
        tasksThisHour: quotas.maxTasksPerHour !== undefined
          ? Math.max(0, quotas.maxTasksPerHour - tasksThisHour) : undefined,
        tasksThisDay: quotas.maxTasksPerDay !== undefined
          ? Math.max(0, quotas.maxTasksPerDay - tasksThisDay) : undefined,
      },
    };
  }
}

/** Result of a quota check */
export interface QuotaCheckResult {
  allowed: boolean;
  violations: string[];
  remaining: {
    tokensThisHour?: number;
    tokensThisDay?: number;
    tasksThisHour?: number;
    tasksThisDay?: number;
  };
}
