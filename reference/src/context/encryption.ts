/**
 * Context envelope encryption for ALXP.
 *
 * Uses X25519 ECDH key exchange + AES-256-GCM symmetric encryption.
 * - Sender generates an ephemeral X25519 keypair
 * - Shared secret derived via ECDH with recipient's public key
 * - Payload encrypted with AES-256-GCM using the HKDF-derived key
 */

import { x25519, ed25519 as ed25519Curves } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** Encrypted payload with all metadata needed for decryption */
export interface EncryptedPayload {
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;
  /** GCM nonce/IV (base64) */
  nonce: string;
  /** Ephemeral X25519 public key (hex) */
  ephemeralPublicKey: string;
  /** Algorithm identifier */
  algorithm: "x25519-aes256gcm";
}

/** An X25519 keypair for key exchange */
export interface X25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Generate an X25519 keypair for ECDH key exchange */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/**
 * Convert an Ed25519 public key to its X25519 (Montgomery) equivalent.
 * Uses the birational map between Edwards and Montgomery curve forms.
 */
export function ed25519ToX25519Public(edPublicKey: Uint8Array): Uint8Array {
  return ed25519Curves.utils.toMontgomery(edPublicKey);
}

/**
 * Convert an Ed25519 private key to its X25519 equivalent.
 * Derives the X25519 scalar from the Ed25519 seed.
 */
export function ed25519ToX25519Private(edPrivateKey: Uint8Array): Uint8Array {
  return ed25519Curves.utils.toMontgomerySecret(edPrivateKey);
}

/** Ensure Uint8Array is backed by a plain ArrayBuffer (needed for Web Crypto API) */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt data for a recipient using their X25519 public key.
 *
 * 1. Generate ephemeral X25519 keypair
 * 2. ECDH with recipient's public key for shared secret
 * 3. HKDF(SHA-256) to derive AES-256 key
 * 4. AES-256-GCM encrypt the payload
 */
export async function encrypt(
  plaintext: string,
  recipientX25519Public: Uint8Array,
): Promise<EncryptedPayload> {
  const ephemeral = generateX25519KeyPair();
  const sharedSecret = x25519.getSharedSecret(ephemeral.privateKey, recipientX25519Public);
  const aesKeyBytes = toBuffer(hkdf(sha256, sharedSecret, undefined, new TextEncoder().encode("alxp-context-v1"), 32));

  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, [
    "encrypt",
  ]);

  const nonce = toBuffer(randomBytes(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    plaintextBytes,
  );

  return {
    ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
    nonce: uint8ToBase64(nonce),
    ephemeralPublicKey: bytesToHex(ephemeral.publicKey),
    algorithm: "x25519-aes256gcm",
  };
}

/**
 * Decrypt data using the recipient's X25519 private key.
 */
export async function decrypt(
  encrypted: EncryptedPayload,
  recipientX25519Private: Uint8Array,
): Promise<string> {
  const ephemeralPublic = hexToBytes(encrypted.ephemeralPublicKey);
  const sharedSecret = x25519.getSharedSecret(recipientX25519Private, ephemeralPublic);
  const aesKeyBytes = toBuffer(hkdf(sha256, sharedSecret, undefined, new TextEncoder().encode("alxp-context-v1"), 32));

  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, [
    "decrypt",
  ]);

  const nonce = toBuffer(base64ToUint8(encrypted.nonce));
  const ciphertext = toBuffer(base64ToUint8(encrypted.ciphertext));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

// ── Base64 utilities ──

function uint8ToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToUint8(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
