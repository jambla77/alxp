import { describe, it, expect } from "vitest";
import {
  TaskStateMachine,
  InvalidTransitionError,
  getTransition,
  getValidTriggers,
  isValidTransition,
} from "../src/lifecycle/state-machine.js";

describe("TaskStateMachine", () => {
  const requester = "did:key:zRequester" as const;
  const worker = "did:key:zWorker" as const;

  it("starts in POSTED state", () => {
    const sm = new TaskStateMachine("task-1", requester);
    expect(sm.state).toBe("POSTED");
  });

  it("follows the happy path through the full lifecycle", () => {
    const sm = new TaskStateMachine("task-1", requester, worker);

    // POSTED → BIDDING
    sm.transition("first_offer_received");
    expect(sm.state).toBe("BIDDING");

    // BIDDING → AWARDED
    sm.transition("offer_accepted", ["requester", "worker"]);
    expect(sm.state).toBe("AWARDED");

    // AWARDED → RUNNING
    sm.transition("context_transferred", ["requester"]);
    expect(sm.state).toBe("RUNNING");

    // RUNNING → SUBMITTED
    sm.transition("result_submitted", ["worker"]);
    expect(sm.state).toBe("SUBMITTED");

    // SUBMITTED → REVIEWING
    sm.transition("review_started", ["requester"]);
    expect(sm.state).toBe("REVIEWING");

    // REVIEWING → ACCEPTED
    sm.transition("result_accepted", ["requester"]);
    expect(sm.state).toBe("ACCEPTED");

    // ACCEPTED → SETTLED
    sm.transition("payment_released", ["requester", "worker"]);
    expect(sm.state).toBe("SETTLED");

    expect(sm.isTerminal()).toBe(true);
    expect(sm.history).toHaveLength(7);
  });

  it("handles checkpoint and blocked states", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "RUNNING");

    // RUNNING → CHECKPOINT
    sm.transition("progress_report", ["worker"]);
    expect(sm.state).toBe("CHECKPOINT");

    // CHECKPOINT → RUNNING
    sm.transition("checkpoint_acknowledged");
    expect(sm.state).toBe("RUNNING");

    // RUNNING → BLOCKED
    sm.transition("input_needed", ["worker"]);
    expect(sm.state).toBe("BLOCKED");

    // BLOCKED → RUNNING
    sm.transition("input_provided", ["requester"]);
    expect(sm.state).toBe("RUNNING");
  });

  it("handles dispute flow", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "REVIEWING");

    sm.transition("dispute_raised", ["worker"]);
    expect(sm.state).toBe("DISPUTED");

    sm.transition("arbitration_started");
    expect(sm.state).toBe("ARBITRATING");

    sm.transition("arbitration_complete");
    expect(sm.state).toBe("RESOLVED");

    expect(sm.isTerminal()).toBe(true);
  });

  it("handles cancellation", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "RUNNING");
    sm.transition("cancelled", ["requester"]);
    expect(sm.state).toBe("CANCELLED");
    expect(sm.isTerminal()).toBe(true);
  });

  it("handles expiration", () => {
    const sm = new TaskStateMachine("task-1", requester);
    sm.transition("expired");
    expect(sm.state).toBe("EXPIRED");
    expect(sm.isTerminal()).toBe(true);
  });

  it("handles worker failure", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "RUNNING");
    sm.transition("worker_failed", ["worker"]);
    expect(sm.state).toBe("FAILED");
    expect(sm.isTerminal()).toBe(true);
  });

  it("throws on invalid transitions", () => {
    const sm = new TaskStateMachine("task-1", requester);

    expect(() => sm.transition("result_submitted", ["worker"])).toThrow(InvalidTransitionError);
  });

  it("throws when required signatures are missing", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "BIDDING");

    expect(() => sm.transition("offer_accepted", ["requester"])).toThrow(
      'requires signature from "worker"',
    );
  });

  it("reports valid triggers from current state", () => {
    const sm = new TaskStateMachine("task-1", requester, worker, "RUNNING");
    const triggers = sm.validTriggers();
    const triggerNames = triggers.map((t) => t.trigger);

    expect(triggerNames).toContain("progress_report");
    expect(triggerNames).toContain("input_needed");
    expect(triggerNames).toContain("result_submitted");
    expect(triggerNames).toContain("cancelled");
    expect(triggerNames).toContain("expired");
    expect(triggerNames).toContain("worker_failed");
  });

  it("checks if a transition is possible", () => {
    const sm = new TaskStateMachine("task-1", requester);
    expect(sm.canTransition("first_offer_received")).toBe(true);
    expect(sm.canTransition("result_submitted")).toBe(false);
  });

  it("records transition history", () => {
    const sm = new TaskStateMachine("task-1", requester);
    sm.transition("first_offer_received");
    sm.transition("offer_accepted", ["requester", "worker"]);

    const history = sm.history;
    expect(history).toHaveLength(2);
    expect(history[0]!.from).toBe("POSTED");
    expect(history[0]!.to).toBe("BIDDING");
    expect(history[1]!.from).toBe("BIDDING");
    expect(history[1]!.to).toBe("AWARDED");
  });
});

describe("transition helpers", () => {
  it("getTransition returns the correct def", () => {
    const t = getTransition("POSTED", "first_offer_received");
    expect(t).not.toBeNull();
    expect(t!.to).toBe("BIDDING");
  });

  it("getTransition returns null for invalid", () => {
    expect(getTransition("POSTED", "result_submitted")).toBeNull();
  });

  it("getValidTriggers returns all from a state", () => {
    const triggers = getValidTriggers("RUNNING");
    expect(triggers.length).toBeGreaterThan(3);
  });

  it("isValidTransition works", () => {
    expect(isValidTransition("POSTED", "first_offer_received")).toBe(true);
    expect(isValidTransition("SETTLED", "first_offer_received")).toBe(false);
  });
});
