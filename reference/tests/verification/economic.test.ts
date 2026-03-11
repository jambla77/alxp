import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../../src/identity/did.js";
import { signString } from "../../src/identity/signing.js";
import { OptimisticVerifier, MockStakingAdapter } from "../../src/verification/economic.js";
import type { TaskContract, ResultBundle, Price, SpotCheckConfig, TaskSpec } from "../../src/types/index.js";

function makeContract(
  requester: ReturnType<typeof generateAgentIdentity>,
  worker: ReturnType<typeof generateAgentIdentity>,
  opts?: { workerStakeId?: string },
): TaskContract {
  const id = ulid();
  const contract: TaskContract = {
    id,
    taskId: ulid(),
    offerId: ulid(),
    requester: requester.did,
    worker: worker.did,
    agreedPrice: { amount: 1.00, currency: "USD", model: "fixed" },
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "optimistic" },
    delegationGrant: {
      issuer: requester.did,
      audience: worker.did,
      capabilities: ["context/read"],
      expiration: new Date(Date.now() + 3600000).toISOString(),
      token: signString(id, requester.keyPair.privateKey),
    },
    cancellationPolicy: { allowedBy: "both", penaltyPercent: 0 },
    requesterSignature: signString(id, requester.keyPair.privateKey),
    workerSignature: signString(id, worker.keyPair.privateKey),
    formed: new Date().toISOString(),
  } as TaskContract;

  if (opts?.workerStakeId) {
    (contract as TaskContract).workerStake = {
      id: opts.workerStakeId,
      contractId: id,
      staker: worker.did,
      amount: { amount: 5.00, currency: "USD", model: "fixed" },
      status: "locked",
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      signature: "mock-sig",
    };
  }

  return contract;
}

function makeResult(
  worker: ReturnType<typeof generateAgentIdentity>,
  contractId: string,
): ResultBundle {
  const id = ulid();
  return {
    id,
    contractId,
    worker: worker.did,
    submitted: new Date().toISOString(),
    outputs: [{ name: "output", mimeType: "text/plain", data: "Result data", encoding: "utf-8" }],
    provenance: {
      agentId: worker.did,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
    },
    signature: signString(id, worker.keyPair.privateKey),
  } as ResultBundle;
}

describe("OptimisticVerifier (Tier 2)", () => {
  it("begins optimistic acceptance with challenge deadline", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const pending = await verifier.beginOptimisticAcceptance(contract, result, "PT1H");

    expect(pending.status).toBe("pending");
    expect(pending.contractId).toBe(contract.id);
    expect(pending.challengeDeadline).toBeTruthy();
    // Challenge deadline should be ~1 hour from now
    const deadline = new Date(pending.challengeDeadline).getTime();
    expect(deadline).toBeGreaterThan(Date.now());
    expect(deadline).toBeLessThan(Date.now() + 7200000); // within 2h
  });

  it("raises challenge within window", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const challenger = generateAgentIdentity();

    adapter.fund(challenger.did, 10.00);

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    await verifier.beginOptimisticAcceptance(contract, result, "PT24H");

    const challenge = await verifier.raiseChallenge(
      contract.id,
      result.id,
      challenger.did,
      "Output is nonsense",
      [{ description: "The output doesn't address the task" }],
      { amount: 2.00, currency: "USD", model: "fixed" },
    );

    expect(challenge.status).toBe("open");
    expect(challenge.challenger).toBe(challenger.did);
    expect(challenge.reason).toBe("Output is nonsense");

    const pending = verifier.getPending(contract.id);
    expect(pending?.status).toBe("challenged");

    // Challenger's balance should be reduced by stake
    expect(adapter.balances.get(challenger.did)).toBe(8.00);
  });

  it("rejects challenge after window closes", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const challenger = generateAgentIdentity();

    adapter.fund(challenger.did, 10.00);

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    // Use a very short window (0 seconds = already expired)
    await verifier.beginOptimisticAcceptance(contract, result, "PT0S");

    // Wait a tiny bit for the deadline to pass
    await new Promise((r) => setTimeout(r, 10));

    await expect(
      verifier.raiseChallenge(
        contract.id,
        result.id,
        challenger.did,
        "Too late",
        [],
        { amount: 1.00, currency: "USD", model: "fixed" },
      ),
    ).rejects.toThrow("Challenge window has closed");
  });

  it("finalizes acceptance and releases stake after window", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    adapter.fund(worker.did, 10.00);
    const workerStake = await adapter.lockStake(
      "contract-x",
      worker.did,
      { amount: 5.00, currency: "USD", model: "fixed" },
    );

    const contract = makeContract(requester, worker, { workerStakeId: workerStake.id });
    const result = makeResult(worker, contract.id);

    // Use 0-second window so it's immediately finalizable
    await verifier.beginOptimisticAcceptance(contract, result, "PT0S");
    await new Promise((r) => setTimeout(r, 10));

    const finalized = await verifier.finalizeAcceptance(contract.id);

    expect(finalized.status).toBe("finalized");
    expect(finalized.stakeReleased).toBe(true);

    // Stake should be released back to worker
    const stake = await adapter.getStake(workerStake.id);
    expect(stake?.status).toBe("released");
    expect(adapter.balances.get(worker.did)).toBe(10.00); // 5 remaining + 5 released
  });

  it("resolves challenge: challenger wins, worker stake slashed", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const challenger = generateAgentIdentity();

    adapter.fund(worker.did, 10.00);
    adapter.fund(challenger.did, 10.00);

    const workerStake = await adapter.lockStake(
      "contract-y",
      worker.did,
      { amount: 5.00, currency: "USD", model: "fixed" },
    );

    const contract = makeContract(requester, worker, { workerStakeId: workerStake.id });
    const result = makeResult(worker, contract.id);

    await verifier.beginOptimisticAcceptance(contract, result, "PT24H");

    const challenge = await verifier.raiseChallenge(
      contract.id,
      result.id,
      challenger.did,
      "Bad work",
      [],
      { amount: 2.00, currency: "USD", model: "fixed" },
    );

    const resolved = await verifier.resolveChallenge(
      challenge.id,
      "challenger-wins",
      "Work was indeed bad",
      workerStake.id,
    );

    expect(resolved.status).toBe("upheld");
    expect(resolved.resolution?.outcome).toBe("challenger-wins");

    // Worker's stake slashed to challenger
    const wStake = await adapter.getStake(workerStake.id);
    expect(wStake?.status).toBe("slashed");

    // Challenger gets worker's stake + their own stake back
    expect(adapter.balances.get(challenger.did)).toBe(8.00 + 5.00 + 2.00); // 8 remaining + 5 slashed + 2 released
  });

  it("resolves challenge: worker wins, challenger stake slashed", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();
    const challenger = generateAgentIdentity();

    adapter.fund(worker.did, 10.00);
    adapter.fund(challenger.did, 10.00);

    const workerStake = await adapter.lockStake(
      "contract-z",
      worker.did,
      { amount: 5.00, currency: "USD", model: "fixed" },
    );

    const contract = makeContract(requester, worker, { workerStakeId: workerStake.id });
    const result = makeResult(worker, contract.id);

    await verifier.beginOptimisticAcceptance(contract, result, "PT24H");

    const challenge = await verifier.raiseChallenge(
      contract.id,
      result.id,
      challenger.did,
      "Frivolous challenge",
      [],
      { amount: 2.00, currency: "USD", model: "fixed" },
    );

    const resolved = await verifier.resolveChallenge(
      challenge.id,
      "worker-wins",
      "Work is actually fine",
      workerStake.id,
    );

    expect(resolved.status).toBe("rejected");
    expect(resolved.resolution?.outcome).toBe("worker-wins");

    // Worker's stake released
    const wStake = await adapter.getStake(workerStake.id);
    expect(wStake?.status).toBe("released");
  });

  it("spot check probability works", () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);

    // With probability 1, should always spot check
    const config1: SpotCheckConfig = { probability: 1, method: "automated-rerun", slashMultiplier: 5 };
    expect(verifier.shouldSpotCheck(config1)).toBe(true);

    // With probability 0, should never spot check
    const config0: SpotCheckConfig = { probability: 0, method: "automated-rerun", slashMultiplier: 5 };
    expect(verifier.shouldSpotCheck(config0)).toBe(false);
  });

  it("spot check runs automated rerun", async () => {
    const adapter = new MockStakingAdapter();
    const verifier = new OptimisticVerifier(adapter);
    const requester = generateAgentIdentity();
    const worker = generateAgentIdentity();

    const contract = makeContract(requester, worker);
    const result = makeResult(worker, contract.id);

    const taskSpecId = ulid();
    const taskSpec: TaskSpec = {
      id: taskSpecId,
      requester: requester.did,
      created: new Date().toISOString(),
      objective: "Test",
      domain: "test",
      expectedOutput: { mimeType: "text/plain" },
      privacyClass: "public",
      delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
      acceptanceCriteria: [{ type: "schema", schema: { type: "string" } }],
      verificationMethod: "automated",
      tags: [],
      signature: signString(taskSpecId, requester.keyPair.privateKey),
    } as TaskSpec;

    const config: SpotCheckConfig = { probability: 1, method: "automated-rerun", slashMultiplier: 10 };
    const spotResult = await verifier.runSpotCheck(contract, result, taskSpec, config);

    expect(spotResult.passed).toBe(true);
    expect(spotResult.method).toBe("automated-rerun");
    expect(spotResult.slashed).toBe(false);
  });
});
