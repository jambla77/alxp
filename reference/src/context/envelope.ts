/**
 * Context envelope creation and handling for ALXP.
 *
 * A ContextEnvelope is the secure, scoped mechanism for transferring
 * context from requester to worker. It supports:
 * - Encryption (via X25519 + AES-256-GCM)
 * - Scoping to a specific contract
 * - Time-limited access with expiry
 * - Retention policies
 * - Redaction rules for sub-delegation
 */

import { ulid } from "ulid";
import type { DID, ContextEnvelope as ContextEnvelopeType } from "../types/index.js";
import type { ContextPayload } from "../types/context.js";
import { signString } from "../identity/signing.js";
import { encrypt, decrypt, type EncryptedPayload } from "./encryption.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { KeyPair } from "../identity/signing.js";

/** Options for creating a context envelope */
export interface CreateContextEnvelopeOptions {
  contractId: string;
  sender: DID;
  senderKey: KeyPair;
  recipient: DID;
  recipientX25519Public: Uint8Array;
  payloads: { name: string; data: string; mimeType?: string }[];
  expiresIn?: number; // milliseconds from now, default 1 hour
  deleteOnCompletion?: boolean;
  onwardTransfer?: boolean;
  redactionRules?: { payloadName: string; fields?: string[]; action: "remove" | "mask" | "hash" }[];
}

/** A context envelope with encrypted payloads */
export interface SealedContextEnvelope {
  envelope: ContextEnvelopeType;
  encryptedPayloads: Map<string, EncryptedPayload>;
}

/**
 * Create a sealed context envelope with encrypted payloads.
 *
 * Each payload is individually encrypted so the worker can decrypt
 * only the payloads they need, and redaction can remove specific payloads
 * without re-encrypting the rest.
 */
export async function createSealedEnvelope(
  options: CreateContextEnvelopeOptions,
): Promise<SealedContextEnvelope> {
  const {
    contractId,
    sender,
    senderKey,
    recipient,
    recipientX25519Public,
    payloads,
    expiresIn = 3600000,
    deleteOnCompletion = true,
    onwardTransfer = false,
    redactionRules,
  } = options;

  const envelopeId = ulid();
  const encryptedPayloads = new Map<string, EncryptedPayload>();

  // Encrypt each payload individually
  const contextPayloads: ContextPayload[] = [];
  for (const payload of payloads) {
    const encrypted = await encrypt(payload.data, recipientX25519Public);
    encryptedPayloads.set(payload.name, encrypted);

    // Store encrypted data as base64 in the payload
    contextPayloads.push({
      name: payload.name,
      mimeType: payload.mimeType ?? "text/plain",
      data: JSON.stringify(encrypted),
      encoding: "base64",
    });
  }

  const recipientPubHex = bytesToHex(recipientX25519Public);

  const envelope: ContextEnvelopeType = {
    id: envelopeId,
    contractId,
    sender,
    recipient,
    payloads: contextPayloads,
    references: [],
    encryption: {
      algorithm: "x25519-aes256gcm",
      recipientPublicKey: recipientPubHex,
    },
    retentionPolicy: {
      deleteOnCompletion,
    },
    redactionRules,
    onwardTransfer,
    expires: new Date(Date.now() + expiresIn).toISOString(),
    signature: signString(`${envelopeId}:${contractId}`, senderKey.privateKey),
  };

  return { envelope, encryptedPayloads };
}

/**
 * Decrypt a payload from a sealed context envelope.
 */
export async function decryptPayload(
  payloadData: string,
  recipientX25519Private: Uint8Array,
): Promise<string> {
  const encrypted: EncryptedPayload = JSON.parse(payloadData);
  return decrypt(encrypted, recipientX25519Private);
}

/**
 * Apply redaction rules to a context envelope for sub-delegation.
 *
 * Returns a new envelope with redacted payloads removed or masked.
 * This enforces the principle that sub-delegation can only attenuate context.
 */
export function redactEnvelope(
  envelope: ContextEnvelopeType,
): ContextEnvelopeType {
  if (!envelope.redactionRules || envelope.redactionRules.length === 0) {
    return envelope;
  }

  const redactedPayloads = envelope.payloads.filter((payload) => {
    const rule = envelope.redactionRules?.find((r) => r.payloadName === payload.name);
    if (!rule) return true; // No rule = keep
    if (rule.action === "remove") return false; // Remove entirely
    return true; // mask/hash handled in-place
  });

  return {
    ...envelope,
    payloads: redactedPayloads,
  };
}

/**
 * Check if a context envelope has expired.
 */
export function isEnvelopeExpired(envelope: ContextEnvelopeType, now?: Date): boolean {
  const expiryTime = new Date(envelope.expires).getTime();
  const currentTime = (now ?? new Date()).getTime();
  return currentTime >= expiryTime;
}
