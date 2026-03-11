/**
 * Metrics collection and reporting for the stress test.
 */

import type { TaskType } from "./task-generators.js";

export interface TaskMetric {
  taskId: string;
  taskType: TaskType;
  workerId: string;
  requesterId: string;
  startTime: number;
  endTime?: number;
  status: "pending" | "completed" | "failed" | "timeout";
  error?: string;
}

export class MetricsCollector {
  private metrics = new Map<string, TaskMetric>();
  private globalStart = 0;

  start(): void {
    this.globalStart = Date.now();
  }

  record(taskId: string, metric: Omit<TaskMetric, "taskId">): void {
    this.metrics.set(taskId, { taskId, ...metric });
  }

  complete(taskId: string, status: "completed" | "failed" | "timeout", error?: string): void {
    const m = this.metrics.get(taskId);
    if (m) {
      m.endTime = Date.now();
      m.status = status;
      m.error = error;
    }
  }

  report(): void {
    const elapsed = (Date.now() - this.globalStart) / 1000;
    const all = [...this.metrics.values()];
    const completed = all.filter((m) => m.status === "completed");
    const failed = all.filter((m) => m.status === "failed");
    const timedOut = all.filter((m) => m.status === "timeout");

    // Latencies
    const latencies = completed
      .filter((m) => m.endTime)
      .map((m) => m.endTime! - m.startTime)
      .sort((a, b) => a - b);

    console.log("\n" + "=".repeat(70));
    console.log("  STRESS TEST RESULTS");
    console.log("=".repeat(70));

    console.log(`\n  Total tasks:    ${all.length}`);
    console.log(`  Completed:      ${completed.length}`);
    console.log(`  Failed:         ${failed.length}`);
    console.log(`  Timed out:      ${timedOut.length}`);
    console.log(`  Wall time:      ${elapsed.toFixed(2)}s`);
    console.log(`  Throughput:     ${(completed.length / elapsed).toFixed(2)} tasks/sec`);

    if (latencies.length > 0) {
      console.log("\n  Latency (ms):");
      console.log(`    min:  ${latencies[0]}`);
      console.log(`    p50:  ${percentile(latencies, 50)}`);
      console.log(`    p95:  ${percentile(latencies, 95)}`);
      console.log(`    p99:  ${percentile(latencies, 99)}`);
      console.log(`    max:  ${latencies[latencies.length - 1]}`);
    }

    // Per-type breakdown
    console.log("\n  Per-type breakdown:");
    for (const type of ["math", "string", "sorting"] as TaskType[]) {
      const typeMetrics = all.filter((m) => m.taskType === type);
      const typeCompleted = typeMetrics.filter((m) => m.status === "completed");
      const typeLats = typeCompleted
        .filter((m) => m.endTime)
        .map((m) => m.endTime! - m.startTime)
        .sort((a, b) => a - b);
      console.log(`    ${type.padEnd(10)} ${typeCompleted.length}/${typeMetrics.length} completed` +
        (typeLats.length > 0 ? `, p50=${percentile(typeLats, 50)}ms` : ""));
    }

    // Per-worker distribution
    const workerMap = new Map<string, number>();
    for (const m of completed) {
      workerMap.set(m.workerId, (workerMap.get(m.workerId) ?? 0) + 1);
    }
    const workerCounts = [...workerMap.values()].sort((a, b) => a - b);
    if (workerCounts.length > 0) {
      console.log(`\n  Worker distribution (${workerMap.size} workers):`);
      console.log(`    min:  ${workerCounts[0]} tasks`);
      console.log(`    max:  ${workerCounts[workerCounts.length - 1]} tasks`);
      console.log(`    avg:  ${(completed.length / workerMap.size).toFixed(1)} tasks`);
    }

    // Errors
    if (failed.length > 0) {
      console.log("\n  Errors:");
      const errorCounts = new Map<string, number>();
      for (const m of failed) {
        const e = m.error ?? "unknown";
        errorCounts.set(e, (errorCounts.get(e) ?? 0) + 1);
      }
      for (const [err, count] of errorCounts) {
        console.log(`    [${count}x] ${err}`);
      }
    }

    console.log("\n" + "=".repeat(70));
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
