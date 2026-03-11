/**
 * UCAN (User Controlled Authorization Networks) implementation for ALXP.
 *
 * UCANs are delegable, attenuable capability tokens. Key properties:
 * - No central authorization server needed
 * - Delegation chains are cryptographically verifiable
 * - Permissions can only be reduced (attenuated), never escalated
 * - Perfect for recursive sub-delegation (Agent A -> B -> C)
 *
 * This is a self-contained implementation (no external UCAN library needed)
 * that follows the UCAN spec: https://ucan.xyz
 */

import { ulid } from "ulid";
import { signString, verifyString, publicKeyToHex, hexToPublicKey } from "./signing.js";
import { publicKeyFromDID } from "./did.js";
import { canonicalize } from "../messages/canonicalize.js";
import type { DID } from "../types/index.js";
import type { KeyPair } from "./signing.js";

/** A UCAN capability — what action on what resource */
export interface UCANCapability {
  /** Resource URI (e.g., "alxp://context/contract-01HXYZ") */
  with: string;
  /** Action (e.g., "context/read", "task/delegate", "task/submit") */
  can: string;
}

/** A UCAN token — the core authorization primitive */
export interface UCANToken {
  /** Version of the UCAN spec */
  ucv: "0.10.0";
  /** Unique token identifier */
  id: string;
  /** Issuer DID — who is granting the capability */
  iss: DID;
  /** Audience DID — who receives the capability */
  aud: DID;
  /** Capabilities being granted */
  att: UCANCapability[];
  /** Expiration (Unix timestamp in seconds) */
  exp: number;
  /** Not before (Unix timestamp in seconds) */
  nbf?: number;
  /** Nonce for replay protection */
  nnc: string;
  /** Proofs — ULIDs of parent tokens in the delegation chain */
  prf: string[];
  /** Facts — additional claims (not capabilities) */
  fct?: Record<string, unknown>;
  /** Signature of the token by the issuer */
  sig: string;
}

/** Options for creating a UCAN token */
export interface CreateUCANOptions {
  issuer: DID;
  issuerKey: KeyPair;
  audience: DID;
  capabilities: UCANCapability[];
  expiration: Date;
  notBefore?: Date;
  proofs?: string[];
  facts?: Record<string, unknown>;
}

/** Result of UCAN verification */
export interface UCANVerifyResult {
  valid: boolean;
  errors: string[];
  /** The full delegation chain if valid */
  chain?: UCANToken[];
}

// ── Well-known ALXP capability actions ──

export const ALXP_CAPABILITIES = {
  /** Read context associated with a task */
  CONTEXT_READ: "context/read",
  /** Write/provide context */
  CONTEXT_WRITE: "context/write",
  /** Submit results for a task */
  TASK_SUBMIT: "task/submit",
  /** Delegate task to another agent */
  TASK_DELEGATE: "task/delegate",
  /** Verify/review submitted work */
  TASK_VERIFY: "task/verify",
  /** Wildcard — all actions on a resource */
  ALL: "*",
} as const;

/**
 * Create a new UCAN token.
 *
 * The issuer signs the token, granting capabilities to the audience.
 * If proofs are provided, this is a delegation (attenuation of a parent token).
 */
export function createUCAN(options: CreateUCANOptions): UCANToken {
  const {
    issuer,
    issuerKey,
    audience,
    capabilities,
    expiration,
    notBefore,
    proofs = [],
    facts,
  } = options;

  const token: Omit<UCANToken, "sig"> & { sig?: string } = {
    ucv: "0.10.0",
    id: ulid(),
    iss: issuer,
    aud: audience,
    att: capabilities,
    exp: Math.floor(expiration.getTime() / 1000),
    nbf: notBefore ? Math.floor(notBefore.getTime() / 1000) : undefined,
    nnc: ulid(),
    prf: proofs,
    fct: facts,
  };

  // Sign the canonical representation of the token (without the signature)
  const payload = canonicalize(token);
  token.sig = signString(payload, issuerKey.privateKey);

  return token as UCANToken;
}

/**
 * Verify a UCAN token's signature.
 *
 * This checks:
 * 1. The signature is valid for the issuer's public key
 * 2. The token has not expired
 * 3. The token's notBefore time has passed (if set)
 */
export function verifyUCAN(token: UCANToken, now?: Date): UCANVerifyResult {
  const errors: string[] = [];
  const currentTime = Math.floor((now ?? new Date()).getTime() / 1000);

  // Check expiration
  if (token.exp <= currentTime) {
    errors.push(`Token expired at ${new Date(token.exp * 1000).toISOString()}`);
  }

  // Check notBefore
  if (token.nbf !== undefined && token.nbf > currentTime) {
    errors.push(`Token not valid until ${new Date(token.nbf * 1000).toISOString()}`);
  }

  // Verify signature
  const { sig, ...unsigned } = token;
  const payload = canonicalize(unsigned);

  try {
    const pubHex = publicKeyFromDID(token.iss);
    const publicKey = hexToPublicKey(pubHex);
    if (!verifyString(sig, payload, publicKey)) {
      errors.push("Invalid signature");
    }
  } catch (err) {
    errors.push(`Cannot resolve issuer key: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    chain: errors.length === 0 ? [token] : undefined,
  };
}

/**
 * Delegate (attenuate) a UCAN token.
 *
 * The audience of the parent token becomes the issuer of the child token.
 * The child token's capabilities must be a subset of the parent's.
 * This enforces the UCAN principle: delegation can only attenuate, never escalate.
 */
export function delegateUCAN(
  parentToken: UCANToken,
  options: {
    delegatorKey: KeyPair;
    audience: DID;
    capabilities: UCANCapability[];
    expiration: Date;
    notBefore?: Date;
    facts?: Record<string, unknown>;
  },
): UCANToken {
  const { delegatorKey, audience, capabilities, expiration, notBefore, facts } = options;

  // The delegator must be the audience of the parent token
  const delegatorDid = `did:key:z${publicKeyToHex(delegatorKey.publicKey)}` as DID;
  if (delegatorDid !== parentToken.aud) {
    throw new Error(
      `Delegator ${delegatorDid} is not the audience of the parent token (${parentToken.aud})`,
    );
  }

  // Validate attenuation — child capabilities must be a subset of parent's
  for (const childCap of capabilities) {
    if (!isCapabilitySubset(childCap, parentToken.att)) {
      throw new AttenuationError(childCap, parentToken.att);
    }
  }

  // Child expiration cannot exceed parent's
  const parentExpMs = parentToken.exp * 1000;
  if (expiration.getTime() > parentExpMs) {
    throw new Error(
      `Delegated token expiration (${expiration.toISOString()}) exceeds parent expiration (${new Date(parentExpMs).toISOString()})`,
    );
  }

  return createUCAN({
    issuer: delegatorDid,
    issuerKey: delegatorKey,
    audience,
    capabilities,
    expiration,
    notBefore,
    proofs: [parentToken.id],
    facts,
  });
}

/**
 * Verify a full delegation chain.
 *
 * Given a token and a store of parent tokens, verifies:
 * 1. Each token in the chain has a valid signature
 * 2. Each delegation is properly attenuated
 * 3. The chain is unbroken (each proof resolves to a valid parent)
 * 4. No token in the chain has expired
 */
export function verifyDelegationChain(
  token: UCANToken,
  tokenStore: UCANTokenStore,
  now?: Date,
): UCANVerifyResult {
  const errors: string[] = [];
  const chain: UCANToken[] = [];

  // Verify the leaf token itself
  const leafResult = verifyUCAN(token, now);
  if (!leafResult.valid) {
    return leafResult;
  }
  chain.push(token);

  // Walk up the proof chain
  let current = token;
  while (current.prf.length > 0) {
    const parentId = current.prf[0]!;
    const parent = tokenStore.get(parentId);

    if (!parent) {
      errors.push(`Proof token not found: ${parentId}`);
      break;
    }

    // Verify parent signature
    const parentResult = verifyUCAN(parent, now);
    if (!parentResult.valid) {
      errors.push(...parentResult.errors.map((e) => `Parent ${parentId}: ${e}`));
      break;
    }

    // Verify delegation link: current.iss must equal parent.aud
    if (current.iss !== parent.aud) {
      errors.push(
        `Broken chain: token ${current.id} issuer (${current.iss}) != parent ${parentId} audience (${parent.aud})`,
      );
      break;
    }

    // Verify attenuation: current capabilities must be subset of parent's
    for (const cap of current.att) {
      if (!isCapabilitySubset(cap, parent.att)) {
        errors.push(
          `Escalation in chain: capability ${cap.can} on ${cap.with} not granted by parent ${parentId}`,
        );
      }
    }

    chain.push(parent);
    current = parent;
  }

  return {
    valid: errors.length === 0,
    errors,
    chain: errors.length === 0 ? chain : undefined,
  };
}

/**
 * Check if a capability is a subset of (granted by) a set of parent capabilities.
 *
 * A capability is considered a subset if:
 * - There exists a parent capability with the same or broader resource scope
 * - The parent capability grants the same or broader action
 *
 * Resource scoping: "alxp://context/contract-01" is a subset of "alxp://context/*"
 * Action scoping: "context/read" is a subset of "*"
 */
export function isCapabilitySubset(
  child: UCANCapability,
  parentCaps: UCANCapability[],
): boolean {
  return parentCaps.some((parent) => {
    const resourceMatch = isResourceSubset(child.with, parent.with);
    const actionMatch = isActionSubset(child.can, parent.can);
    return resourceMatch && actionMatch;
  });
}

/** Check if a child resource URI is within the scope of a parent resource URI */
function isResourceSubset(child: string, parent: string): boolean {
  if (parent === child) return true;
  if (parent === "*") return true;

  // Wildcard matching: "alxp://context/*" covers "alxp://context/contract-01"
  if (parent.endsWith("/*")) {
    const prefix = parent.slice(0, -1); // Remove the *
    return child.startsWith(prefix);
  }

  // Prefix matching: "alxp://context/contract-01" covers "alxp://context/contract-01/payload-1"
  if (child.startsWith(parent + "/")) return true;

  return false;
}

/** Check if a child action is within the scope of a parent action */
function isActionSubset(child: string, parent: string): boolean {
  if (parent === child) return true;
  if (parent === "*") return true;

  // Namespace prefix: "context/*" covers "context/read"
  if (parent.endsWith("/*")) {
    const prefix = parent.slice(0, -2);
    return child.startsWith(prefix + "/") || child === prefix;
  }

  return false;
}

/** Error thrown when a delegation attempts to escalate capabilities */
export class AttenuationError extends Error {
  constructor(
    public readonly requested: UCANCapability,
    public readonly available: UCANCapability[],
  ) {
    const availStr = available.map((c) => `${c.can} on ${c.with}`).join(", ");
    super(
      `Cannot delegate "${requested.can}" on "${requested.with}" — not covered by available capabilities: [${availStr}]`,
    );
    this.name = "AttenuationError";
  }
}

/** Simple in-memory token store for resolving proof chains */
export class UCANTokenStore {
  private tokens = new Map<string, UCANToken>();

  store(token: UCANToken): void {
    this.tokens.set(token.id, token);
  }

  get(id: string): UCANToken | null {
    return this.tokens.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.tokens.has(id);
  }

  /** Get all tokens issued by a specific DID */
  issuedBy(did: DID): UCANToken[] {
    return [...this.tokens.values()].filter((t) => t.iss === did);
  }

  /** Get all tokens granted to a specific DID */
  grantedTo(did: DID): UCANToken[] {
    return [...this.tokens.values()].filter((t) => t.aud === did);
  }
}
