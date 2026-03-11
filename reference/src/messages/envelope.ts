import { ulid } from "ulid";
import { signString, verifyString, hexToPublicKey } from "../identity/signing.js";
import { publicKeyFromDID } from "../identity/did.js";
import { ProtocolMessage, PROTOCOL_VERSION, type MessagePayload, type DID } from "../types/index.js";
import { canonicalize } from "./canonicalize.js";

/** Options for creating a protocol message */
export interface CreateMessageOptions {
  sender: DID;
  privateKey: Uint8Array;
  payload: MessagePayload;
  recipient?: DID;
  replyTo?: string;
  headers?: Record<string, string>;
}

/**
 * Create a signed ProtocolMessage envelope.
 *
 * The signature covers the canonicalized JSON of the message
 * (excluding the signature field itself).
 */
export function createMessage(options: CreateMessageOptions): ProtocolMessage {
  const { sender, privateKey, payload, recipient, replyTo, headers } = options;

  // Build the message without signature
  const unsigned = {
    version: PROTOCOL_VERSION,
    id: ulid(),
    timestamp: new Date().toISOString(),
    sender,
    recipient,
    replyTo,
    payload,
    headers,
    signature: "", // placeholder
  };

  // Canonicalize without signature for signing
  const toSign = canonicalize({ ...unsigned, signature: undefined });
  const signature = signString(toSign, privateKey);

  return { ...unsigned, signature } as ProtocolMessage;
}

/**
 * Verify the signature of a ProtocolMessage.
 * Resolves the sender's public key from their DID.
 */
export function verifyMessage(message: ProtocolMessage): boolean {
  const { signature, ...rest } = message;
  const toVerify = canonicalize({ ...rest, signature: undefined });
  const pubHex = publicKeyFromDID(message.sender);
  const publicKey = hexToPublicKey(pubHex);
  return verifyString(signature, toVerify, publicKey);
}

/**
 * Validate message structure against the Zod schema.
 * Returns parsed message or throws.
 */
export function parseMessage(raw: unknown): ProtocolMessage {
  return ProtocolMessage.parse(raw);
}
