import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { generateAgentIdentity, publicKeyFromDID } from "../src/identity/did.js";
import { signString, hexToPublicKey } from "../src/identity/signing.js";
import { generateAgentCard } from "../src/discovery/agent-card.js";
import { TaskBoard, verifyTaskSignature } from "../src/discovery/task-board.js";
import { RegistryServer } from "../src/discovery/registry.js";
import { ulid } from "ulid";

/** Helper: create a signed TaskSpec */
function makeTaskSpec(identity: ReturnType<typeof generateAgentIdentity>, overrides: Record<string, any> = {}) {
  const taskId = ulid();
  return {
    id: taskId,
    requester: identity.did,
    created: new Date().toISOString(),
    objective: overrides.objective ?? "Write unit tests",
    domain: overrides.domain ?? "coding",
    inputs: [],
    expectedOutput: { mimeType: "text/plain", description: "Modified files" },
    privacyClass: "public" as const,
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: false },
    acceptanceCriteria: [{ type: "schema" as const, schema: { type: "object" } }],
    verificationMethod: "optimistic" as const,
    tags: overrides.tags ?? [],
    signature: signString(taskId, identity.keyPair.privateKey),
    ...overrides,
  };
}

describe("TaskBoard", () => {
  let board: TaskBoard;
  const requester = generateAgentIdentity();

  beforeEach(() => {
    board = new TaskBoard({ defaultTTL: 60_000 });
  });

  it("post() stores task with correct expiration", () => {
    const spec = makeTaskSpec(requester);
    const posted = board.post(spec, "http://requester:9000");

    expect(posted.taskSpec).toBe(spec);
    expect(posted.replyEndpoint).toBe("http://requester:9000");
    expect(posted.postedAt).toBeTruthy();
    expect(new Date(posted.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(board.size).toBe(1);
  });

  it("tasks with explicit expires use that instead of default TTL", () => {
    const customExpires = new Date(Date.now() + 5000).toISOString();
    const spec = makeTaskSpec(requester, { expires: customExpires });
    const posted = board.post(spec, "http://requester:9000");

    expect(posted.expiresAt).toBe(customExpires);
  });

  it("get() retrieves posted task", () => {
    const spec = makeTaskSpec(requester);
    board.post(spec, "http://requester:9000");

    const retrieved = board.get(spec.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.taskSpec.id).toBe(spec.id);
  });

  it("get() returns null for missing task", () => {
    expect(board.get("nonexistent")).toBeNull();
  });

  it("remove() deletes task", () => {
    const spec = makeTaskSpec(requester);
    board.post(spec, "http://requester:9000");
    expect(board.size).toBe(1);

    const removed = board.remove(spec.id);
    expect(removed).toBe(true);
    expect(board.size).toBe(0);
    expect(board.get(spec.id)).toBeNull();
  });

  it("remove() returns false for missing task", () => {
    expect(board.remove("nonexistent")).toBe(false);
  });

  it("query() filters by domain", () => {
    board.post(makeTaskSpec(requester, { domain: "coding" }), "http://r:9000");
    board.post(makeTaskSpec(requester, { domain: "translation" }), "http://r:9000");
    board.post(makeTaskSpec(requester, { domain: "coding" }), "http://r:9000");

    const results = board.query({ domain: "coding" });
    expect(results).toHaveLength(2);

    const transResults = board.query({ domain: "translation" });
    expect(transResults).toHaveLength(1);

    const emptyResults = board.query({ domain: "legal" });
    expect(emptyResults).toHaveLength(0);
  });

  it("query() filters by tags", () => {
    board.post(makeTaskSpec(requester, { tags: ["typescript", "testing"] }), "http://r:9000");
    board.post(makeTaskSpec(requester, { tags: ["python"] }), "http://r:9000");

    const results = board.query({ tags: ["typescript"] });
    expect(results).toHaveLength(1);

    const noMatch = board.query({ tags: ["rust"] });
    expect(noMatch).toHaveLength(0);
  });

  it("query() filters by requester", () => {
    const other = generateAgentIdentity();
    board.post(makeTaskSpec(requester), "http://r:9000");
    board.post(makeTaskSpec(other), "http://r:9000");

    const results = board.query({ requester: requester.did });
    expect(results).toHaveLength(1);
    expect(results[0]!.taskSpec.requester).toBe(requester.did);
  });

  it("query() respects limit", () => {
    for (let i = 0; i < 5; i++) {
      board.post(makeTaskSpec(requester), "http://r:9000");
    }

    const results = board.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("query() filters by maxBudget", () => {
    board.post(makeTaskSpec(requester, {
      budget: { maxAmount: 50, currency: "USD" },
    }), "http://r:9000");
    board.post(makeTaskSpec(requester, {
      budget: { maxAmount: 200, currency: "USD" },
    }), "http://r:9000");

    const results = board.query({ maxBudget: 100 });
    expect(results).toHaveLength(1);
    expect(results[0]!.taskSpec.budget!.maxAmount).toBe(50);
  });

  it("matchForWorker() finds tasks matching worker capabilities", () => {
    board.post(makeTaskSpec(requester, { domain: "coding", tags: ["typescript"] }), "http://r:9000");
    board.post(makeTaskSpec(requester, { domain: "translation" }), "http://r:9000");
    board.post(makeTaskSpec(requester, { domain: "coding", tags: ["python"] }), "http://r:9000");

    const workerCaps = [
      { domain: "coding", subDomain: "general", tags: ["typescript", "javascript"], confidenceLevel: 0.9 },
    ];

    const results = board.matchForWorker(workerCaps);
    expect(results).toHaveLength(1);
    expect(results[0]!.taskSpec.tags).toContain("typescript");
  });

  it("matchForWorker() matches tasks with no tags against any capability in the same domain", () => {
    board.post(makeTaskSpec(requester, { domain: "coding", tags: [] }), "http://r:9000");

    const workerCaps = [
      { domain: "coding", tags: ["typescript"] },
    ];

    const results = board.matchForWorker(workerCaps);
    expect(results).toHaveLength(1);
  });

  it("sweep() removes expired tasks", () => {
    // Post a task that expires in the past
    const spec = makeTaskSpec(requester, {
      expires: new Date(Date.now() - 1000).toISOString(),
    });
    board.post(spec, "http://r:9000");

    // Post a task that expires in the future
    board.post(makeTaskSpec(requester), "http://r:9000");

    expect(board.size).toBe(2);

    const expired = board.sweep();
    expect(expired).toHaveLength(1);
    expect(expired[0]).toBe(spec.id);
    expect(board.size).toBe(1);
  });

  it("query() excludes expired tasks", () => {
    board.post(makeTaskSpec(requester, {
      expires: new Date(Date.now() - 1000).toISOString(),
    }), "http://r:9000");
    board.post(makeTaskSpec(requester), "http://r:9000");

    const results = board.query({});
    expect(results).toHaveLength(1);
  });

  it("list() excludes expired tasks", () => {
    board.post(makeTaskSpec(requester, {
      expires: new Date(Date.now() - 1000).toISOString(),
    }), "http://r:9000");
    board.post(makeTaskSpec(requester), "http://r:9000");

    expect(board.list()).toHaveLength(1);
  });

  it("rejects when board is full", () => {
    const smallBoard = new TaskBoard({ maxTasks: 2 });
    smallBoard.post(makeTaskSpec(requester), "http://r:9000");
    smallBoard.post(makeTaskSpec(requester), "http://r:9000");

    expect(() => smallBoard.post(makeTaskSpec(requester), "http://r:9000"))
      .toThrow("Task board is full");
  });

  it("startSweeping() and stopSweeping() manage interval", () => {
    board.startSweeping();
    // Calling twice is safe
    board.startSweeping();
    board.stopSweeping();
    // Calling twice is safe
    board.stopSweeping();
  });
});

describe("Task signature verification", () => {
  it("valid task signature passes", () => {
    const identity = generateAgentIdentity();
    const spec = makeTaskSpec(identity);
    expect(verifyTaskSignature(spec)).toBe(true);
  });

  it("tampered signature is rejected", () => {
    const identity = generateAgentIdentity();
    const spec = makeTaskSpec(identity);
    spec.signature = "deadbeef".repeat(16);
    expect(verifyTaskSignature(spec)).toBe(false);
  });

  it("wrong signer is rejected", () => {
    const identity = generateAgentIdentity();
    const other = generateAgentIdentity();
    const taskId = ulid();

    const spec = {
      ...makeTaskSpec(identity, { id: taskId }),
      // Signed by other's key but claims identity's DID
      signature: signString(taskId, other.keyPair.privateKey),
    };

    expect(verifyTaskSignature(spec)).toBe(false);
  });
});

describe("Registry HTTP — Task Board routes", () => {
  const PORT = 9740;
  let server: RegistryServer;
  const requester = generateAgentIdentity();

  beforeAll(async () => {
    server = new RegistryServer();
    await server.listen(PORT);
  });

  afterAll(async () => {
    server?.taskBoard.stopSweeping();
    await server?.close();
  });

  it("full task board HTTP lifecycle", async () => {
    const base = `http://localhost:${PORT}`;

    const spec = makeTaskSpec(requester, { domain: "coding", tags: ["typescript"] });

    // POST /tasks — stores signed task (201)
    const postRes = await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSpec: spec, replyEndpoint: "http://requester:9000" }),
    });
    expect(postRes.status).toBe(201);
    const postData = await postRes.json() as { status: string; taskId: string };
    expect(postData.status).toBe("posted");
    expect(postData.taskId).toBe(spec.id);

    // POST /tasks — rejects bad signature (401)
    const badSpec = { ...makeTaskSpec(requester), signature: "bad" };
    const badRes = await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSpec: badSpec, replyEndpoint: "http://requester:9000" }),
    });
    expect(badRes.status).toBe(401);

    // GET /tasks/:id — returns task
    const getRes = await fetch(`${base}/tasks/${spec.id}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as { taskSpec: { id: string } };
    expect(getData.taskSpec.id).toBe(spec.id);

    // GET /tasks/:id — 404 for missing
    const missingRes = await fetch(`${base}/tasks/nonexistent`);
    expect(missingRes.status).toBe(404);

    // POST /tasks/query — filters correctly
    const queryRes = await fetch(`${base}/tasks/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "coding" }),
    });
    expect(queryRes.status).toBe(200);
    const queryData = await queryRes.json() as { tasks: any[]; count: number };
    expect(queryData.count).toBe(1);
    expect(queryData.tasks[0].taskSpec.id).toBe(spec.id);

    // POST /tasks/query — empty for non-matching domain
    const emptyRes = await fetch(`${base}/tasks/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "translation" }),
    });
    const emptyData = await emptyRes.json() as { count: number };
    expect(emptyData.count).toBe(0);

    // POST /tasks/match — returns worker-relevant tasks
    const matchRes = await fetch(`${base}/tasks/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilities: [{ domain: "coding", tags: ["typescript"] }],
      }),
    });
    expect(matchRes.status).toBe(200);
    const matchData = await matchRes.json() as { tasks: any[]; count: number };
    expect(matchData.count).toBe(1);

    // DELETE /tasks/:id — removes task
    const deleteRes = await fetch(`${base}/tasks/${spec.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    // Confirm removal
    const afterDelete = await fetch(`${base}/tasks/${spec.id}`);
    expect(afterDelete.status).toBe(404);

    // DELETE /tasks/:id — 404 for already removed
    const deleteAgain = await fetch(`${base}/tasks/${spec.id}`, { method: "DELETE" });
    expect(deleteAgain.status).toBe(404);
  });

  it("expired tasks excluded from queries", async () => {
    const base = `http://localhost:${PORT}`;

    const expiredSpec = makeTaskSpec(requester, {
      domain: "coding",
      expires: new Date(Date.now() - 1000).toISOString(),
    });

    // Post an expired task (the board stores it but queries should exclude it)
    await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSpec: expiredSpec, replyEndpoint: "http://r:9000" }),
    });

    const queryRes = await fetch(`${base}/tasks/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "coding" }),
    });
    const data = await queryRes.json() as { count: number };
    expect(data.count).toBe(0);
  });
});

describe("Integration: pull-based marketplace flow", () => {
  const PORT_REGISTRY = 9750;
  const PORT_REQUESTER = 9751;
  const PORT_WORKER = 9752;
  let registryServer: RegistryServer;

  beforeAll(async () => {
    registryServer = new RegistryServer();
    await registryServer.listen(PORT_REGISTRY);
  });

  afterAll(async () => {
    registryServer?.taskBoard.stopSweeping();
    await registryServer?.close();
  });

  it("requester posts → worker queries → worker bids to replyEndpoint", async () => {
    const registryUrl = `http://localhost:${PORT_REGISTRY}`;

    // 2. Requester creates identity and posts a task
    const requester = generateAgentIdentity(`http://localhost:${PORT_REQUESTER}`);
    const taskSpec = makeTaskSpec(requester, { domain: "coding", tags: ["typescript"] });
    const replyEndpoint = `http://localhost:${PORT_REQUESTER}`;

    const postRes = await fetch(`${registryUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSpec, replyEndpoint }),
    });
    expect(postRes.status).toBe(201);

    // 3. Worker queries the board for matching tasks
    const queryRes = await fetch(`${registryUrl}/tasks/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "coding" }),
    });
    const queryData = await queryRes.json() as { tasks: any[]; count: number };
    expect(queryData.count).toBe(1);

    const postedTask = queryData.tasks[0];
    expect(postedTask.taskSpec.id).toBe(taskSpec.id);
    expect(postedTask.replyEndpoint).toBe(replyEndpoint);

    // 4. Worker would send BID to replyEndpoint (peer-to-peer)
    // We verify the replyEndpoint is correct and the task data is intact
    expect(postedTask.taskSpec.objective).toBe(taskSpec.objective);
    expect(postedTask.taskSpec.domain).toBe("coding");
    expect(postedTask.taskSpec.requester).toBe(requester.did);
  });

  it("worker uses /tasks/match with capabilities", async () => {
    const registryUrl = `http://localhost:${PORT_REGISTRY}`;

    // Post a translation task
    const requester = generateAgentIdentity();
    const transSpec = makeTaskSpec(requester, { domain: "translation", tags: ["french"] });
    await fetch(`${registryUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSpec: transSpec, replyEndpoint: "http://r:9000" }),
    });

    // Worker with coding capabilities shouldn't see translation tasks
    const matchRes = await fetch(`${registryUrl}/tasks/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilities: [{ domain: "coding", tags: ["typescript"] }],
      }),
    });
    const matchData = await matchRes.json() as { tasks: any[]; count: number };

    // Should match the coding task from previous test, not the translation one
    for (const task of matchData.tasks) {
      expect(task.taskSpec.domain).toBe("coding");
    }
  });
});
