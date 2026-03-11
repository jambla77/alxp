import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// ed25519 v3 requires sha512 to be set explicitly
ed25519.hashes.sha512 = sha512;

/** A keypair for Ed25519 signing */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Generate a new Ed25519 keypair */
export function generateKeyPair(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/** Sign a message with a private key */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Verify a signature against a message and public key */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, message, publicKey);
}

/** Sign a UTF-8 string, return hex-encoded signature */
export function signString(data: string, privateKey: Uint8Array): string {
  const message = new TextEncoder().encode(data);
  const sig = sign(message, privateKey);
  return ed25519.etc.bytesToHex(sig);
}

/** Verify a hex-encoded signature against a UTF-8 string */
export function verifyString(
  signatureHex: string,
  data: string,
  publicKey: Uint8Array,
): boolean {
  const message = new TextEncoder().encode(data);
  const sig = ed25519.etc.hexToBytes(signatureHex);
  return verify(sig, message, publicKey);
}

/** Encode a public key as hex string */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return ed25519.etc.bytesToHex(publicKey);
}

/** Decode a hex string to public key bytes */
export function hexToPublicKey(hex: string): Uint8Array {
  return ed25519.etc.hexToBytes(hex);
}

/** Decode a hex string to raw bytes (alias for non-key hex data) */
export function hexToBytes(hex: string): Uint8Array {
  return ed25519.etc.hexToBytes(hex);
}
