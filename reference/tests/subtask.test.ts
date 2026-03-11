import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { createUCAN, verifyUCAN } from "../src/identity/ucan.js";
import { SubDelegationManager } from "../src/delegation/subtask.js";

describe("SubDelegationManager", () => {
  const makeSetup = () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const subWorker = generateAgentIdentity();

    // Requester grants worker broad capabilities
    const parentUCAN = createUCAN({
      issuer: requester.did,
      issuerKey: requester.keyPair,
      audience: worker.did,
      capabilities: [
        { with: "alxp://task/*", can: "*" },
        { with: "alxp://context/*", can: "*" },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    return { requester, worker, subWorker, parentUCAN };
  };

  it("creates subtasks with delegated UCAN tokens", () => {
    const { worker, subWorker, parentUCAN } = makeSetup();

    const manager = new SubDelegationManager({
      parentTaskId: ulid(),
      parentContractId: ulid(),
      worker: worker.did,
      workerKey: worker.keyPair,
      parentUCAN,
      delegationPolicy: { maxDepth: 1, allowSubDelegation: true },
    });

    const subtask = manager.createSubTask({
      objective: "Analyze the security of the authentication module",
      domain: "code-review",
      subWorker: subWorker.did,
      expiration: new Date(Date.now() + 1800000),
      inputs: [{ name: "code", data: "function auth() { ... }" }],
    });

    expect(subtask.status).toBe("pending");
    expect(subtask.spec.objective).toBe("Analyze the security of the authentication module");
    expect(subtask.spec.parentTaskId).toBeTruthy();
    expect(subtask.delegation.iss).toBe(worker.did);
    expect(subtask.delegation.aud).toBe(subWorker.did);

    // Verify the delegated UCAN is valid
    const result = verifyUCAN(subtask.delegation);
    expect(result.valid).toBe(true);

    // Capabilities should be narrowed to the subtask
    expect(subtask.delegation.att).toHaveLength(2);
    expect(subtask.delegation.att[0]!.can).toBe("task/submit");
    expect(subtask.delegation.att[1]!.can).toBe("context/read");

    expect(manager.size).toBe(1);
  });

  it("tracks subtask lifecycle", () => {
    const { worker, subWorker, parentUCAN } = makeSetup();

    const manager = new SubDelegationManager({
      parentTaskId: ulid(),
      parentContractId: ulid(),
      worker: worker.did,
      workerKey: worker.keyPair,
      parentUCAN,
      delegationPolicy: { maxDepth: 1, allowSubDelegation: true },
    });

    const subtask = manager.createSubTask({
      objective: "Subtask 1",
      domain: "test",
      subWorker: subWorker.did,
      expiration: new Date(Date.now() + 1800000),
    });

    expect(subtask.status).toBe("pending");

    manager.markDelegated(subtask.spec.id);
    expect(manager.getSubTask(subtask.spec.id)!.status).toBe("delegated");

    manager.markCompleted(subtask.spec.id, "Result data here");
    const completed = manager.getSubTask(subtask.spec.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("Result data here");
  });

  it("manages multiple subtasks", () => {
    const { worker, parentUCAN } = makeSetup();
    const sub1 = generateAgentIdentity();
    const sub2 = generateAgentIdentity();
    const sub3 = generateAgentIdentity();

    const manager = new SubDelegationManager({
      parentTaskId: ulid(),
      parentContractId: ulid(),
      worker: worker.did,
      workerKey: worker.keyPair,
      parentUCAN,
      delegationPolicy: { maxDepth: 1, allowSubDelegation: true },
    });

    const s1 = manager.createSubTask({
      objective: "Review auth",
      domain: "code-review",
      subWorker: sub1.did,
      expiration: new Date(Date.now() + 1800000),
    });

    const s2 = manager.createSubTask({
      objective: "Review database",
      domain: "code-review",
      subWorker: sub2.did,
      expiration: new Date(Date.now() + 1800000),
    });

    const s3 = manager.createSubTask({
      objective: "Review API",
      domain: "code-review",
      subWorker: sub3.did,
      expiration: new Date(Date.now() + 1800000),
    });

    expect(manager.size).toBe(3);
    expect(manager.allCompleted()).toBe(false);

    // Complete two
    manager.markCompleted(s1.spec.id, "Auth looks secure");
    manager.markCompleted(s2.spec.id, "SQL injection found");
    expect(manager.allCompleted()).toBe(false);

    // Complete the last
    manager.markCompleted(s3.spec.id, "API endpoints properly authenticated");
    expect(manager.allCompleted()).toBe(true);

    // Collect results
    const results = manager.collectResults();
    expect(results.size).toBe(3);
  });

  it("detects failed subtasks", () => {
    const { worker, subWorker, parentUCAN } = makeSetup();

    const manager = new SubDelegationManager({
      parentTaskId: ulid(),
      parentContractId: ulid(),
      worker: worker.did,
      workerKey: worker.keyPair,
      parentUCAN,
      delegationPolicy: { maxDepth: 1, allowSubDelegation: true },
    });

    const s1 = manager.createSubTask({
      objective: "Task A",
      domain: "test",
      subWorker: subWorker.did,
      expiration: new Date(Date.now() + 1800000),
    });

    manager.markFailed(s1.spec.id);
    expect(manager.anyFailed()).toBe(true);
    expect(manager.allCompleted()).toBe(false);
  });

  it("rejects sub-delegation when policy forbids it", () => {
    const { worker, parentUCAN } = makeSetup();

    expect(() => {
      new SubDelegationManager({
        parentTaskId: ulid(),
        parentContractId: ulid(),
        worker: worker.did,
        workerKey: worker.keyPair,
        parentUCAN,
        delegationPolicy: { maxDepth: 0, allowSubDelegation: false },
      });
    }).toThrow("not allowed");
  });

  it("subtask UCAN cannot exceed parent expiration", () => {
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const subWorker = generateAgentIdentity();

    const parentUCAN = createUCAN({
      issuer: requester.did,
      issuerKey: requester.keyPair,
      audience: worker.did,
      capabilities: [
        { with: "alxp://task/*", can: "*" },
        { with: "alxp://context/*", can: "*" },
      ],
      expiration: new Date(Date.now() + 1800000), // 30 min
    });

    const manager = new SubDelegationManager({
      parentTaskId: ulid(),
      parentContractId: ulid(),
      worker: worker.did,
      workerKey: worker.keyPair,
      parentUCAN,
      delegationPolicy: { maxDepth: 1, allowSubDelegation: true },
    });

    // Subtask expiration within parent — should work
    const ok = manager.createSubTask({
      objective: "Short task",
      domain: "test",
      subWorker: subWorker.did,
      expiration: new Date(Date.now() + 900000), // 15 min
    });
    expect(ok.delegation).toBeTruthy();

    // Subtask expiration beyond parent — should throw
    expect(() => {
      manager.createSubTask({
        objective: "Long task",
        domain: "test",
        subWorker: subWorker.did,
        expiration: new Date(Date.now() + 7200000), // 2 hours (exceeds parent 30 min)
      });
    }).toThrow("exceeds parent expiration");
  });
});
