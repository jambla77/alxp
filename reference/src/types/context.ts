import { z } from "zod";
import {
  DID,
  ISO8601,
  ULID,
  URL_,
  Signature,
  EncryptionInfo,
  RetentionPolicy,
} from "./primitives.js";

/** Context payload — actual data sent to the worker */
export const ContextPayload = z.object({
  name: z.string(),
  mimeType: z.string().default("text/plain"),
  data: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});
export type ContextPayload = z.infer<typeof ContextPayload>;

/** Context reference — pointer to external data */
export const ContextReference = z.object({
  name: z.string(),
  url: URL_,
  mimeType: z.string().optional(),
  accessToken: z.string().optional(),
});
export type ContextReference = z.infer<typeof ContextReference>;

/** Redaction rule — what must be stripped before sub-delegation */
export const RedactionRule = z.object({
  payloadName: z.string(),
  fields: z.array(z.string()).optional(),
  action: z.enum(["remove", "mask", "hash"]),
});
export type RedactionRule = z.infer<typeof RedactionRule>;

/** Context Envelope — secure, scoped context transfer */
export const ContextEnvelope = z.object({
  id: ULID,
  contractId: ULID,
  sender: DID,
  recipient: DID,

  // Content
  payloads: z.array(ContextPayload).default([]),
  references: z.array(ContextReference).default([]),

  // Privacy
  encryption: EncryptionInfo,
  retentionPolicy: RetentionPolicy,
  redactionRules: z.array(RedactionRule).optional(),
  onwardTransfer: z.boolean().default(false),

  // Expiry
  expires: ISO8601,
  revocationEndpoint: URL_.optional(),

  signature: Signature,
});
export type ContextEnvelope = z.infer<typeof ContextEnvelope>;
