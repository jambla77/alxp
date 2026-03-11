import { describe, it, expect } from "vitest";
import { generateAgentIdentity } from "../src/identity/did.js";
import {
  createUCAN,
  verifyUCAN,
  delegateUCAN,
  verifyDelegationChain,
  isCapabilitySubset,
  UCANTokenStore,
  AttenuationError,
  ALXP_CAPABILITIES,
} from "../src/identity/ucan.js";

describe("UCAN token creation and verification", () => {
  it("creates a valid UCAN token", () => {
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [
        { with: "alxp://context/contract-01", can: ALXP_CAPABILITIES.CONTEXT_READ },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    expect(token.ucv).toBe("0.10.0");
    expect(token.iss).toBe(issuer.did);
    expect(token.aud).toBe(audience.did);
    expect(token.att).toHaveLength(1);
    expect(token.sig).toBeTruthy();
    expect(token.prf).toEqual([]);
  });

  it("verifies a valid token", () => {
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [
        { with: "alxp://task/123", can: ALXP_CAPABILITIES.TASK_SUBMIT },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    const result = verifyUCAN(token);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.chain).toHaveLength(1);
  });

  it("rejects expired tokens", () => {
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() - 1000), // Already expired
    });

    const result = verifyUCAN(token);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("expired");
  });

  it("rejects tokens used before notBefore", () => {
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 7200000),
      notBefore: new Date(Date.now() + 3600000), // Not valid for another hour
    });

    const result = verifyUCAN(token);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not valid until");
  });

  it("rejects tampered tokens", () => {
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });

    // Tamper: change the audience
    const tampered = { ...token, aud: "did:key:zTampered" };
    const result = verifyUCAN(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Invalid signature");
  });
});

describe("UCAN delegation (attenuation)", () => {
  it("delegates with attenuated capabilities", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();

    // Root grants broad capabilities to middle
    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [
        { with: "alxp://context/*", can: "*" },
        { with: "alxp://task/*", can: "*" },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    // Middle delegates narrower capabilities to leaf
    const delegated = delegateUCAN(rootToken, {
      delegatorKey: middle.keyPair,
      audience: leaf.did,
      capabilities: [
        { with: "alxp://context/contract-01", can: ALXP_CAPABILITIES.CONTEXT_READ },
      ],
      expiration: new Date(Date.now() + 1800000), // Shorter expiry
    });

    expect(delegated.iss).toBe(middle.did);
    expect(delegated.aud).toBe(leaf.did);
    expect(delegated.att).toHaveLength(1);
    expect(delegated.prf).toEqual([rootToken.id]);

    // Verify the delegated token
    const result = verifyUCAN(delegated);
    expect(result.valid).toBe(true);
  });

  it("rejects delegation that escalates capabilities", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();

    // Root grants limited capabilities
    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [
        { with: "alxp://context/contract-01", can: ALXP_CAPABILITIES.CONTEXT_READ },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    // Middle tries to escalate to write (should fail)
    expect(() => {
      delegateUCAN(rootToken, {
        delegatorKey: middle.keyPair,
        audience: leaf.did,
        capabilities: [
          { with: "alxp://context/contract-01", can: ALXP_CAPABILITIES.CONTEXT_WRITE },
        ],
        expiration: new Date(Date.now() + 1800000),
      });
    }).toThrow(AttenuationError);
  });

  it("rejects delegation that broadens resource scope", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();

    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [
        { with: "alxp://context/contract-01", can: "*" },
      ],
      expiration: new Date(Date.now() + 3600000),
    });

    // Middle tries to get access to ALL contexts (escalation)
    expect(() => {
      delegateUCAN(rootToken, {
        delegatorKey: middle.keyPair,
        audience: leaf.did,
        capabilities: [
          { with: "alxp://context/*", can: ALXP_CAPABILITIES.CONTEXT_READ },
        ],
        expiration: new Date(Date.now() + 1800000),
      });
    }).toThrow(AttenuationError);
  });

  it("rejects delegation beyond parent expiration", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();

    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000), // 1 hour
    });

    // Middle tries to delegate for longer than root allows
    expect(() => {
      delegateUCAN(rootToken, {
        delegatorKey: middle.keyPair,
        audience: leaf.did,
        capabilities: [{ with: "*", can: "*" }],
        expiration: new Date(Date.now() + 7200000), // 2 hours (exceeds parent)
      });
    }).toThrow("exceeds parent expiration");
  });

  it("rejects delegation by wrong party", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const imposter = generateAgentIdentity();
    const leaf = generateAgentIdentity();

    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });

    // Imposter tries to delegate (not the audience of the root token)
    expect(() => {
      delegateUCAN(rootToken, {
        delegatorKey: imposter.keyPair,
        audience: leaf.did,
        capabilities: [{ with: "*", can: "*" }],
        expiration: new Date(Date.now() + 1800000),
      });
    }).toThrow("not the audience");
  });
});

describe("delegation chain verification", () => {
  it("verifies a 3-level delegation chain", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();
    const store = new UCANTokenStore();

    // Root → Middle (broad)
    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [{ with: "alxp://context/*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });
    store.store(rootToken);

    // Middle → Leaf (narrow)
    const delegated = delegateUCAN(rootToken, {
      delegatorKey: middle.keyPair,
      audience: leaf.did,
      capabilities: [
        { with: "alxp://context/contract-01", can: ALXP_CAPABILITIES.CONTEXT_READ },
      ],
      expiration: new Date(Date.now() + 1800000),
    });
    store.store(delegated);

    // Verify the full chain
    const result = verifyDelegationChain(delegated, store);
    expect(result.valid).toBe(true);
    expect(result.chain).toHaveLength(2); // delegated + root
    expect(result.chain![0]!.id).toBe(delegated.id);
    expect(result.chain![1]!.id).toBe(rootToken.id);
  });

  it("rejects chain with broken link", () => {
    const root = generateAgentIdentity();
    const middle = generateAgentIdentity();
    const leaf = generateAgentIdentity();
    const store = new UCANTokenStore();

    const rootToken = createUCAN({
      issuer: root.did,
      issuerKey: root.keyPair,
      audience: middle.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });
    // Don't store rootToken — the chain will be broken

    const delegated = delegateUCAN(rootToken, {
      delegatorKey: middle.keyPair,
      audience: leaf.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 1800000),
    });

    const result = verifyDelegationChain(delegated, store);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Proof token not found");
  });
});

describe("capability subset checking", () => {
  it("exact match", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://task/123", can: "task/submit" },
        [{ with: "alxp://task/123", can: "task/submit" }],
      ),
    ).toBe(true);
  });

  it("wildcard action match", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://task/123", can: "task/submit" },
        [{ with: "alxp://task/123", can: "*" }],
      ),
    ).toBe(true);
  });

  it("wildcard resource match", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://context/contract-01", can: "context/read" },
        [{ with: "alxp://context/*", can: "context/read" }],
      ),
    ).toBe(true);
  });

  it("global wildcard", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://anything/here", can: "any/action" },
        [{ with: "*", can: "*" }],
      ),
    ).toBe(true);
  });

  it("rejects non-matching resource", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://context/other", can: "context/read" },
        [{ with: "alxp://context/contract-01", can: "context/read" }],
      ),
    ).toBe(false);
  });

  it("rejects non-matching action", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://task/123", can: "task/delegate" },
        [{ with: "alxp://task/123", can: "task/submit" }],
      ),
    ).toBe(false);
  });

  it("namespace action matching", () => {
    expect(
      isCapabilitySubset(
        { with: "alxp://task/123", can: "task/submit" },
        [{ with: "alxp://task/123", can: "task/*" }],
      ),
    ).toBe(true);
  });
});

describe("UCANTokenStore", () => {
  it("stores and retrieves tokens", () => {
    const store = new UCANTokenStore();
    const issuer = generateAgentIdentity();
    const audience = generateAgentIdentity();

    const token = createUCAN({
      issuer: issuer.did,
      issuerKey: issuer.keyPair,
      audience: audience.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });

    store.store(token);
    expect(store.get(token.id)).toBe(token);
    expect(store.has(token.id)).toBe(true);
  });

  it("queries by issuer and audience", () => {
    const store = new UCANTokenStore();
    const a = generateAgentIdentity();
    const b = generateAgentIdentity();
    const c = generateAgentIdentity();

    const t1 = createUCAN({
      issuer: a.did,
      issuerKey: a.keyPair,
      audience: b.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });

    const t2 = createUCAN({
      issuer: a.did,
      issuerKey: a.keyPair,
      audience: c.did,
      capabilities: [{ with: "*", can: "*" }],
      expiration: new Date(Date.now() + 3600000),
    });

    store.store(t1);
    store.store(t2);

    expect(store.issuedBy(a.did)).toHaveLength(2);
    expect(store.grantedTo(b.did)).toHaveLength(1);
    expect(store.grantedTo(c.did)).toHaveLength(1);
  });
});
