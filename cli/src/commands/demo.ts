/**
 * `alxp demo` — Zero-config capacity sharing demo.
 */

import {
  generateAgentIdentity,
  signString,
  generateAgentCard,
  AgentRegistry,
  HeartbeatTracker,
  CreditLedger,
  CreditSettlementAdapter,
  calculateCreditCost,
} from "@alxp/reference";
import type { TaskContract, WorkReceipt, Heartbeat } from "@alxp/reference";
import { ulid } from "ulid";

function hasRemainingCapacity(state: { capacitySnapshot?: { remainingShared?: number } } | undefined): boolean {
  if (!state) return false;
  return (state.capacitySnapshot?.remainingShared ?? 0) > 0;
}

function makeContract(
  requesterId: string,
  workerId: string,
  amount: number,
  reqKey: Uint8Array,
  workerKey: Uint8Array,
): TaskContract {
  const id = ulid();
  return {
    id,
    taskId: ulid(),
    offerId: ulid(),
    requester: requesterId,
    worker: workerId,
    agreedPrice: { amount, currency: "credits", model: "fixed" },
    agreedDeadline: new Date(Date.now() + 3600000).toISOString(),
    agreedVerification: { method: "automated" },
    delegationGrant: {
      issuer: requesterId,
      audience: workerId,
      capabilities: ["context/read"],
      expiration: new Date(Date.now() + 3600000).toISOString(),
      token: signString(id, reqKey),
    },
    cancellationPolicy: { allowedBy: "both", penaltyPercent: 0 },
    requesterSignature: signString(id, reqKey),
    workerSignature: signString(id, workerKey),
    formed: new Date().toISOString(),
  } as TaskContract;
}

function makeReceipt(contractId: string, requesterId: string, workerId: string, reqKey: Uint8Array, workerKey: Uint8Array): WorkReceipt {
  const id = ulid();
  return {
    id,
    contractId,
    taskId: ulid(),
    requester: requesterId,
    worker: workerId,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    taskDomain: "code-generation",
    effortTier: "medium",
    requesterSignature: signString(id, reqKey),
    workerSignature: signString(id, workerKey),
  } as WorkReceipt;
}

export async function runDemo(): Promise<void> {
  console.log("=== ALXP Capacity Sharing Demo ===\n");

  const registry = new AgentRegistry();
  const heartbeats = new HeartbeatTracker({ staleTimeout: 60000 });
  const ledger = new CreditLedger();
  const settlement = new CreditSettlementAdapter(ledger);

  const alice = generateAgentIdentity();
  const bob = generateAgentIdentity();

  // 1. Register agents
  console.log("1. Registering agents with subscription capacity...\n");

  const aliceCard = generateAgentCard({
    identity: alice,
    capabilities: [{ domain: "code-generation", subDomain: "typescript", confidenceLevel: 0.95, tags: ["typescript", "react"] }],
    trustTier: "open-internet",
    endpoint: `https://alice.local/alxp`,
    capabilityTier: "high",
    capacitySource: {
      provider: "anthropic",
      tier: "max",
      planName: "Claude Max",
      capacityType: "messages",
      totalCapacity: 1000,
      sharedCapacity: 500,
      reservedForOwner: 500,
      modelAccess: ["claude-sonnet-4", "claude-opus-4"],
    },
    capacitySnapshot: {
      remainingInPeriod: 800,
      remainingShared: 400,
      utilizationRate: 0.2,
    },
  });

  const bobCard = generateAgentCard({
    identity: bob,
    capabilities: [{ domain: "code-generation", subDomain: "general", confidenceLevel: 0.8, tags: ["python", "typescript"] }],
    trustTier: "open-internet",
    endpoint: `https://bob.local/alxp`,
    capabilityTier: "medium",
    capacitySource: {
      provider: "local",
      tier: "local-gpu",
      capacityType: "unlimited-local",
      modelAccess: ["llama-3.1-70b", "codellama"],
    },
    capacitySnapshot: {
      remainingShared: 99999,
      utilizationRate: 0.1,
    },
  });

  registry.register(aliceCard);
  registry.register(bobCard);

  console.log(`   Alice: Claude Max subscriber (sharing 500 messages/month)`);
  console.log(`   Bob:   RTX 4090 (sharing local GPU time — unlimited)\n`);

  // 2. Heartbeats
  console.log("2. Agents heartbeat with capacity snapshots...\n");

  const aliceHb: Heartbeat = {
    type: "HEARTBEAT",
    agentId: alice.did,
    status: "online",
    capacity: 0.8,
    currentTasks: 0,
    capacitySnapshot: { remainingShared: 400, utilizationRate: 0.2 },
  };
  const bobHb: Heartbeat = {
    type: "HEARTBEAT",
    agentId: bob.did,
    status: "online",
    capacity: 0.9,
    currentTasks: 0,
    capacitySnapshot: { remainingShared: 99999, utilizationRate: 0.1 },
  };

  heartbeats.recordHeartbeat(aliceHb);
  heartbeats.recordHeartbeat(bobHb);

  console.log(`   Alice: ${hasRemainingCapacity(heartbeats.getState(alice.did) ?? undefined) ? "has" : "no"} remaining capacity`);
  console.log(`   Bob:   ${hasRemainingCapacity(heartbeats.getState(bob.did) ?? undefined) ? "has" : "no"} remaining capacity\n`);

  // 3. Donate capacity → earn credits
  console.log("3. Donating unused capacity...\n");

  ledger.donate(alice.did, 1000, "Sharing 50% of Claude Max monthly capacity");
  ledger.donate(bob.did, 500, "Sharing RTX 4090 compute time");

  console.log(`   Alice donated capacity → earned 1000 credits`);
  console.log(`   Bob donated capacity → earned 500 credits\n`);

  // 4. Alice uses Bob's GPU
  console.log("4. Alice uses Bob's local GPU for a fast draft...\n");

  const localCost = calculateCreditCost("medium", { providerTier: "local:local-gpu" });
  console.log(`   Cost for medium task on local GPU: ${localCost} credits`);

  const contract1 = makeContract(alice.did, bob.did, localCost, alice.keyPair.privateKey, bob.keyPair.privateKey);
  const escrow1 = await settlement.createEscrow(contract1);
  const receipt1 = makeReceipt(contract1.id, alice.did, bob.did, alice.keyPair.privateKey, bob.keyPair.privateKey);
  await settlement.releaseEscrow(escrow1.id, receipt1);

  console.log(`   Alice spent ${localCost} credits → Bob earned ${localCost} credits\n`);

  // 5. Bob uses Alice's Claude
  console.log("5. Bob uses Alice's Claude capacity for polish...\n");

  const claudeCost = calculateCreditCost("medium", { providerTier: "anthropic:max" });
  console.log(`   Cost for medium task on Claude Max: ${claudeCost} credits`);

  const contract2 = makeContract(bob.did, alice.did, claudeCost, bob.keyPair.privateKey, alice.keyPair.privateKey);
  const escrow2 = await settlement.createEscrow(contract2);
  const receipt2 = makeReceipt(contract2.id, bob.did, alice.did, bob.keyPair.privateKey, alice.keyPair.privateKey);
  await settlement.releaseEscrow(escrow2.id, receipt2);

  console.log(`   Bob spent ${claudeCost} credits → Alice earned ${claudeCost} credits\n`);

  // 6. Final balances
  console.log("6. Final balances:\n");

  const aliceFinal = ledger.getBalance(alice.did);
  const bobFinal = ledger.getBalance(bob.did);

  console.log(`   Alice: ${aliceFinal.available} credits available`);
  console.log(`     donated: ${aliceFinal.donated}, earned: ${aliceFinal.earned}, spent: ${aliceFinal.spent}`);
  console.log(`   Bob:   ${bobFinal.available} credits available`);
  console.log(`     donated: ${bobFinal.donated}, earned: ${bobFinal.earned}, spent: ${bobFinal.spent}\n`);

  console.log("Nobody paid extra money. Both used capacity they already had.");
  console.log("Alice's Claude subscription + Bob's GPU = shared AI capacity network.\n");

  // 7. Discovery
  console.log("7. Discovery: finding agents by provider...\n");

  const claudeAgents = registry.query({ domain: "code-generation", preferredProvider: "anthropic" });
  console.log(`   Agents with Anthropic capacity: ${claudeAgents.length}`);

  const localAgents = registry.query({ domain: "code-generation", preferredProvider: "local" });
  console.log(`   Agents with local GPU: ${localAgents.length}`);

  const cloudOnly = registry.query({ domain: "code-generation", acceptLocalModels: false });
  console.log(`   Cloud-only agents: ${cloudOnly.length}`);

  const highCapacity = registry.query({ domain: "code-generation", minRemainingCapacity: 100 });
  console.log(`   Agents with 100+ remaining capacity: ${highCapacity.length}\n`);

  console.log("=== Demo complete ===");
}
