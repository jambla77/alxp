import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  signString,
  verifyString,
  publicKeyToHex,
  hexToPublicKey,
} from "../src/identity/signing.js";
import {
  generateAgentIdentity,
  publicKeyFromDID,
  DIDResolver,
} from "../src/identity/did.js";

describe("Ed25519 signing", () => {
  it("generates a keypair", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it("signs and verifies a string", () => {
    const kp = generateKeyPair();
    const data = "Hello, ALXP!";
    const sig = signString(data, kp.privateKey);

    expect(verifyString(sig, data, kp.publicKey)).toBe(true);
  });

  it("rejects tampered data", () => {
    const kp = generateKeyPair();
    const sig = signString("original", kp.privateKey);

    expect(verifyString(sig, "tampered", kp.publicKey)).toBe(false);
  });

  it("rejects wrong public key", () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = signString("data", kp1.privateKey);

    expect(verifyString(sig, "data", kp2.publicKey)).toBe(false);
  });

  it("roundtrips public key through hex", () => {
    const kp = generateKeyPair();
    const hex = publicKeyToHex(kp.publicKey);
    const restored = hexToPublicKey(hex);

    expect(restored).toEqual(kp.publicKey);
  });
});

describe("DID identity", () => {
  it("generates an agent identity", () => {
    const identity = generateAgentIdentity("https://agent.example.com/alxp");

    expect(identity.did).toMatch(/^did:key:z/);
    expect(identity.document.id).toBe(identity.did);
    expect(identity.document.verificationMethod).toHaveLength(1);
    expect(identity.document.service).toHaveLength(1);
    expect(identity.document.service![0]!.serviceEndpoint).toBe(
      "https://agent.example.com/alxp",
    );
  });

  it("generates identity without endpoint", () => {
    const identity = generateAgentIdentity();
    expect(identity.did).toMatch(/^did:key:z/);
    expect(identity.document.service).toBeUndefined();
  });

  it("extracts public key from did:key", () => {
    const identity = generateAgentIdentity();
    const pubHex = publicKeyFromDID(identity.did);
    const pubKey = hexToPublicKey(pubHex);

    expect(pubKey).toEqual(identity.keyPair.publicKey);
  });

  it("throws for non did:key DIDs", () => {
    expect(() => publicKeyFromDID("did:web:example.com")).toThrow();
  });
});

describe("DID Resolver", () => {
  it("resolves did:key DIDs from the DID itself", () => {
    const resolver = new DIDResolver();
    const identity = generateAgentIdentity();

    const doc = resolver.resolve(identity.did);
    expect(doc).not.toBeNull();
    expect(doc!.id).toBe(identity.did);
  });

  it("resolves registered DIDs", () => {
    const resolver = new DIDResolver();
    const identity = generateAgentIdentity();
    resolver.register(identity.did, identity.document);

    const doc = resolver.resolve(identity.did);
    expect(doc).not.toBeNull();
    expect(doc!.id).toBe(identity.did);
  });
});
