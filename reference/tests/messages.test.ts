import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { generateAgentIdentity } from "../src/identity/did.js";
import { signString } from "../src/identity/signing.js";
import { createMessage, verifyMessage, parseMessage } from "../src/messages/envelope.js";
import { canonicalize } from "../src/messages/canonicalize.js";
import { validateMessage } from "../src/messages/validation.js";
import { MessageRouter } from "../src/messages/handlers.js";
import type { AnnounceTask, ProtocolMessage } from "../src/types/index.js";

function makeTaskSpec(requesterDid: string, privateKey: Uint8Array) {
  return {
    id: ulid(),
    requester: requesterDid,
    created: new Date().toISOString(),
    objective: "Summarize this paragraph",
    domain: "summarization",
    inputs: [{ name: "paragraph", mimeType: "text/plain", data: "The quick brown fox..." }],
    expectedOutput: { mimeType: "text/plain", description: "A summary" },
    privacyClass: "public" as const,
    delegationPolicy: { allowSubDelegation: false, maxDepth: 0, requireApproval: true },
    acceptanceCriteria: [{ type: "schema" as const, schema: { type: "string" } }],
    verificationMethod: "optimistic" as const,
    tags: ["test"],
    signature: signString("task", privateKey),
  };
}

describe("canonicalize", () => {
  it("sorts keys deterministically", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("handles nested objects", () => {
    const result = canonicalize({ z: { b: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it("handles arrays (order preserved)", () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("omits undefined values", () => {
    const result = canonicalize({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it("handles null", () => {
    expect(canonicalize(null)).toBe("null");
  });
});

describe("message envelope", () => {
  it("creates and verifies a signed message", () => {
    const identity = generateAgentIdentity();
    const taskSpec = makeTaskSpec(identity.did, identity.keyPair.privateKey);

    const message = createMessage({
      sender: identity.did,
      privateKey: identity.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec },
    });

    expect(message.version).toBe("alxp/0.1");
    expect(message.sender).toBe(identity.did);
    expect(message.payload.type).toBe("ANNOUNCE_TASK");
    expect(message.signature).toBeTruthy();

    // Verify signature
    expect(verifyMessage(message)).toBe(true);
  });

  it("rejects tampered messages", () => {
    const identity = generateAgentIdentity();
    const taskSpec = makeTaskSpec(identity.did, identity.keyPair.privateKey);

    const message = createMessage({
      sender: identity.did,
      privateKey: identity.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec },
    });

    // Tamper with the message
    const tampered = { ...message, timestamp: "2099-01-01T00:00:00.000Z" };
    expect(verifyMessage(tampered as ProtocolMessage)).toBe(false);
  });

  it("validates correct message structure", () => {
    const identity = generateAgentIdentity();
    const taskSpec = makeTaskSpec(identity.did, identity.keyPair.privateKey);

    const message = createMessage({
      sender: identity.did,
      privateKey: identity.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec },
    });

    const result = validateMessage(message);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid message structure", () => {
    const result = validateMessage({ version: "wrong" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("MessageRouter", () => {
  it("routes messages to registered handlers", async () => {
    const router = new MessageRouter();
    const received: ProtocolMessage[] = [];

    router.on<AnnounceTask>("ANNOUNCE_TASK", async (msg) => {
      received.push(msg);
    });

    const identity = generateAgentIdentity();
    const taskSpec = makeTaskSpec(identity.did, identity.keyPair.privateKey);

    const message = createMessage({
      sender: identity.did,
      privateKey: identity.keyPair.privateKey,
      payload: { type: "ANNOUNCE_TASK", taskSpec },
    });

    await router.route(message);
    expect(received).toHaveLength(1);
    expect(received[0]!.payload.type).toBe("ANNOUNCE_TASK");
  });

  it("reports whether handlers exist", () => {
    const router = new MessageRouter();
    expect(router.hasHandler("ANNOUNCE_TASK")).toBe(false);

    router.on("ANNOUNCE_TASK", async () => {});
    expect(router.hasHandler("ANNOUNCE_TASK")).toBe(true);
  });
});
