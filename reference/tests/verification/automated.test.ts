import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateAgentIdentity } from "../../src/identity/did.js";
import { signString } from "../../src/identity/signing.js";
import { canonicalize } from "../../src/messages/canonicalize.js";
import { runAutomatedVerification } from "../../src/verification/automated.js";
import type { ResultBundle, TaskSpec } from "../../src/types/index.js";

function makeResult(
  worker: ReturnType<typeof generateAgentIdentity>,
  outputs: { name: string; mimeType?: string; data: string }[],
): ResultBundle {
  const id = ulid();
  return {
    id,
    contractId: ulid(),
    worker: worker.did,
    submitted: new Date().toISOString(),
    outputs: outputs.map((o) => ({
      name: o.name,
      mimeType: o.mimeType ?? "text/plain",
      data: o.data,
      encoding: "utf-8" as const,
    })),
    provenance: {
      agentId: worker.did,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
    },
    signature: signString(id, worker.keyPair.privateKey),
  } as ResultBundle;
}

function makeTaskSpec(
  requester: ReturnType<typeof generateAgentIdentity>,
  acceptanceCriteria: TaskSpec["acceptanceCriteria"],
  verificationMethod: TaskSpec["verificationMethod"] = "automated",
): TaskSpec {
  const id = ulid();
  return {
    id,
    requester: requester.did,
    created: new Date().toISOString(),
    objective: "Test task",
    domain: "test",
    expectedOutput: { mimeType: "text/plain" },
    privacyClass: "public",
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria,
    verificationMethod,
    tags: [],
    signature: signString(id, requester.keyPair.privateKey),
  } as TaskSpec;
}

describe("Automated Verification (Tier 1)", () => {
  const requester = generateAgentIdentity();
  const worker = generateAgentIdentity();

  it("schema check passes with valid string output", async () => {
    const result = makeResult(worker, [
      { name: "summary", data: "A valid summary string" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
    expect(verification.checks).toHaveLength(1);
    expect(verification.checks[0]!.criteriaType).toBe("schema");
    expect(verification.score).toBe(1);
  });

  it("schema check fails with empty string output", async () => {
    const result = makeResult(worker, [
      { name: "summary", data: "" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(false);
    expect(verification.checks[0]!.passed).toBe(false);
  });

  it("schema check validates JSON output against object schema", async () => {
    const result = makeResult(worker, [
      {
        name: "result",
        mimeType: "application/json",
        data: JSON.stringify({ name: "Alice", age: 30 }),
      },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      {
        type: "schema",
        schema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" }, age: { type: "number" } },
        },
      },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
  });

  it("schema check fails when required property missing", async () => {
    const result = makeResult(worker, [
      {
        name: "result",
        mimeType: "application/json",
        data: JSON.stringify({ age: 30 }),
      },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      {
        type: "schema",
        schema: {
          type: "object",
          required: ["name"],
        },
      },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(false);
    expect(verification.checks[0]!.details).toContain("name");
  });

  it("hash check passes with matching hash", async () => {
    const outputData = "Deterministic output data";
    const canonical = canonicalize(outputData);
    const expectedHash = bytesToHex(sha256(new TextEncoder().encode(canonical)));

    const result = makeResult(worker, [
      { name: "output", data: outputData },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "hash", expectedHash },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
    expect(verification.checks[0]!.details).toBe("Hash matches");
  });

  it("hash check fails with wrong hash", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Some output" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "hash", expectedHash: "0000000000000000000000000000000000000000000000000000000000000000" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(false);
    expect(verification.checks[0]!.details).toContain("mismatch");
  });

  it("test suite: contains check", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Hello world from the agent" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "test", testSuite: "contains:Hello world" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
  });

  it("test suite: min-length and max-length", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Short" },
    ]);

    // Passes min-length
    const taskSpec1 = makeTaskSpec(requester, [
      { type: "test", testSuite: "min-length:3" },
    ]);
    expect((await runAutomatedVerification(result, taskSpec1)).passed).toBe(true);

    // Fails min-length
    const taskSpec2 = makeTaskSpec(requester, [
      { type: "test", testSuite: "min-length:100" },
    ]);
    expect((await runAutomatedVerification(result, taskSpec2)).passed).toBe(false);

    // Passes max-length
    const taskSpec3 = makeTaskSpec(requester, [
      { type: "test", testSuite: "max-length:100" },
    ]);
    expect((await runAutomatedVerification(result, taskSpec3)).passed).toBe(true);

    // Fails max-length
    const taskSpec4 = makeTaskSpec(requester, [
      { type: "test", testSuite: "max-length:3" },
    ]);
    expect((await runAutomatedVerification(result, taskSpec4)).passed).toBe(false);
  });

  it("test suite: regex check", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Answer: 42" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "test", testSuite: "regex:\\d+" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
  });

  it("test suite: json-valid check", async () => {
    const result = makeResult(worker, [
      { name: "output", data: '{"key": "value"}' },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "test", testSuite: "json-valid" },
    ]);

    expect((await runAutomatedVerification(result, taskSpec)).passed).toBe(true);

    // Invalid JSON
    const badResult = makeResult(worker, [
      { name: "output", data: "not json {" },
    ]);
    expect((await runAutomatedVerification(badResult, taskSpec)).passed).toBe(false);
  });

  it("test suite: multiple checks separated by semicolons", async () => {
    const result = makeResult(worker, [
      { name: "output", data: '{"result": 42}' },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "test", testSuite: "json-valid;min-length:5;contains:result" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
  });

  it("multiple criteria: all must pass", async () => {
    const outputData = "Valid output string";
    const canonical = canonicalize(outputData);
    const expectedHash = bytesToHex(sha256(new TextEncoder().encode(canonical)));

    const result = makeResult(worker, [
      { name: "output", data: outputData },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
      { type: "hash", expectedHash },
      { type: "test", testSuite: "contains:Valid" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(true);
    expect(verification.checks).toHaveLength(3);
    expect(verification.score).toBe(1);
  });

  it("multiple criteria: one failure means overall failure", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Valid output string" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "schema", schema: { type: "string" } },
      { type: "hash", expectedHash: "wrong-hash" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    expect(verification.passed).toBe(false);
    expect(verification.score).toBe(0.5);
  });

  it("non-automated criteria are skipped", async () => {
    const result = makeResult(worker, [
      { name: "output", data: "Some output" },
    ]);
    const taskSpec = makeTaskSpec(requester, [
      { type: "rubric", rubric: "Be excellent", minScore: 0.8 },
      { type: "consensus", validators: 3, threshold: 0.67 },
      { type: "human", reviewer: requester.did },
      { type: "optimistic", challengeWindow: "PT24H" },
    ]);

    const verification = await runAutomatedVerification(result, taskSpec);
    // No automated checks run, so score is 0 and passed is false
    expect(verification.checks).toHaveLength(0);
    expect(verification.passed).toBe(false);
    expect(verification.score).toBe(0);
  });
});
