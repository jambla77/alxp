import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  generateX25519KeyPair,
  ed25519ToX25519Public,
  ed25519ToX25519Private,
} from "../src/context/encryption.js";
import {
  createSealedEnvelope,
  decryptPayload,
  redactEnvelope,
  isEnvelopeExpired,
} from "../src/context/envelope.js";
import { generateAgentIdentity } from "../src/identity/did.js";
import type { ContextEnvelope } from "../src/types/index.js";

describe("X25519 key exchange + AES-256-GCM encryption", () => {
  it("generates X25519 keypairs", () => {
    const kp = generateX25519KeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it("encrypts and decrypts data", async () => {
    const recipient = generateX25519KeyPair();
    const plaintext = "Hello, ALXP! This is a secret context payload.";

    const encrypted = await encrypt(plaintext, recipient.publicKey);
    expect(encrypted.algorithm).toBe("x25519-aes256gcm");
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.nonce).toBeTruthy();
    expect(encrypted.ephemeralPublicKey).toBeTruthy();

    const decrypted = await decrypt(encrypted, recipient.privateKey);
    expect(decrypted).toBe(plaintext);
  });

  it("different encryptions produce different ciphertexts", async () => {
    const recipient = generateX25519KeyPair();
    const plaintext = "Same message";

    const e1 = await encrypt(plaintext, recipient.publicKey);
    const e2 = await encrypt(plaintext, recipient.publicKey);

    // Ephemeral keys and nonces should differ
    expect(e1.ephemeralPublicKey).not.toBe(e2.ephemeralPublicKey);
    expect(e1.nonce).not.toBe(e2.nonce);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);

    // Both should decrypt to the same plaintext
    expect(await decrypt(e1, recipient.privateKey)).toBe(plaintext);
    expect(await decrypt(e2, recipient.privateKey)).toBe(plaintext);
  });

  it("wrong key fails to decrypt", async () => {
    const recipient = generateX25519KeyPair();
    const wrongKey = generateX25519KeyPair();
    const plaintext = "Secret data";

    const encrypted = await encrypt(plaintext, recipient.publicKey);

    await expect(decrypt(encrypted, wrongKey.privateKey)).rejects.toThrow();
  });

  it("handles large payloads", async () => {
    const recipient = generateX25519KeyPair();
    const plaintext = "x".repeat(100_000);

    const encrypted = await encrypt(plaintext, recipient.publicKey);
    const decrypted = await decrypt(encrypted, recipient.privateKey);
    expect(decrypted).toBe(plaintext);
  });

  it("handles unicode content", async () => {
    const recipient = generateX25519KeyPair();
    const plaintext = "Bonjour le monde! \u{1F30D} \u{1F916} \u4F60\u597D\u4E16\u754C";

    const encrypted = await encrypt(plaintext, recipient.publicKey);
    const decrypted = await decrypt(encrypted, recipient.privateKey);
    expect(decrypted).toBe(plaintext);
  });
});

describe("Ed25519 to X25519 key conversion", () => {
  it("converts Ed25519 keys to X25519 and encrypts/decrypts", async () => {
    const identity = generateAgentIdentity();

    // Convert Ed25519 keys to X25519
    const x25519Pub = ed25519ToX25519Public(identity.keyPair.publicKey);
    const x25519Priv = ed25519ToX25519Private(identity.keyPair.privateKey);

    expect(x25519Pub.length).toBe(32);
    expect(x25519Priv.length).toBe(32);

    // Encrypt with converted public key
    const plaintext = "Encrypted for Ed25519 identity";
    const encrypted = await encrypt(plaintext, x25519Pub);

    // Decrypt with converted private key
    const decrypted = await decrypt(encrypted, x25519Priv);
    expect(decrypted).toBe(plaintext);
  });
});

describe("sealed context envelopes", () => {
  it("creates and decrypts a sealed envelope", async () => {
    const sender = generateAgentIdentity();
    const recipient = generateAgentIdentity();
    const recipientX25519 = ed25519ToX25519Public(recipient.keyPair.publicKey);
    const recipientX25519Priv = ed25519ToX25519Private(recipient.keyPair.privateKey);

    const { envelope } = await createSealedEnvelope({
      contractId: "01HXYZ0000000000000000TEST",
      sender: sender.did,
      senderKey: sender.keyPair,
      recipient: recipient.did,
      recipientX25519Public: recipientX25519,
      payloads: [
        { name: "document", data: "This is a confidential document.", mimeType: "text/plain" },
        { name: "instructions", data: "Summarize the document above." },
      ],
    });

    expect(envelope.sender).toBe(sender.did);
    expect(envelope.recipient).toBe(recipient.did);
    expect(envelope.payloads).toHaveLength(2);
    expect(envelope.encryption.algorithm).toBe("x25519-aes256gcm");

    // Decrypt each payload
    const doc = await decryptPayload(envelope.payloads[0]!.data, recipientX25519Priv);
    expect(doc).toBe("This is a confidential document.");

    const instr = await decryptPayload(envelope.payloads[1]!.data, recipientX25519Priv);
    expect(instr).toBe("Summarize the document above.");
  });

  it("applies redaction rules", async () => {
    const sender = generateAgentIdentity();
    const recipient = generateAgentIdentity();
    const recipientX25519 = ed25519ToX25519Public(recipient.keyPair.publicKey);

    const { envelope } = await createSealedEnvelope({
      contractId: "01HXYZ0000000000000000TEST",
      sender: sender.did,
      senderKey: sender.keyPair,
      recipient: recipient.did,
      recipientX25519Public: recipientX25519,
      payloads: [
        { name: "public-data", data: "This can be shared" },
        { name: "private-data", data: "This must be redacted" },
      ],
      redactionRules: [{ payloadName: "private-data", action: "remove" }],
    });

    expect(envelope.payloads).toHaveLength(2); // Before redaction

    const redacted = redactEnvelope(envelope);
    expect(redacted.payloads).toHaveLength(1);
    expect(redacted.payloads[0]!.name).toBe("public-data");
  });
});

describe("envelope expiry", () => {
  it("detects unexpired envelopes", () => {
    const envelope = {
      expires: new Date(Date.now() + 3600000).toISOString(),
    } as ContextEnvelope;

    expect(isEnvelopeExpired(envelope)).toBe(false);
  });

  it("detects expired envelopes", () => {
    const envelope = {
      expires: new Date(Date.now() - 1000).toISOString(),
    } as ContextEnvelope;

    expect(isEnvelopeExpired(envelope)).toBe(true);
  });
});
