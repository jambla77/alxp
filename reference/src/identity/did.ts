import { generateKeyPair, publicKeyToHex, type KeyPair } from "./signing.js";
import type { DID } from "../types/index.js";

/** DID Document (simplified for did:key method) */
export interface DIDDocument {
  "@context": string;
  id: DID;
  verificationMethod: {
    id: string;
    type: string;
    controller: DID;
    publicKeyHex: string;
  }[];
  authentication: string[];
  assertionMethod: string[];
  service?: {
    id: string;
    type: string;
    serviceEndpoint: string;
  }[];
}

/** Agent identity: DID + keypair + optional endpoint */
export interface AgentIdentity {
  did: DID;
  keyPair: KeyPair;
  document: DIDDocument;
}

/**
 * Generate a new agent identity using did:key method.
 * did:key is self-certifying — the DID IS the public key.
 */
export function generateAgentIdentity(endpoint?: string): AgentIdentity {
  const keyPair = generateKeyPair();
  const pubHex = publicKeyToHex(keyPair.publicKey);
  const did: DID = `did:key:z${pubHex}` as DID;

  const document: DIDDocument = {
    "@context": "https://www.w3.org/ns/did/v1",
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex: pubHex,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
  };

  if (endpoint) {
    document.service = [
      {
        id: `${did}#alxp`,
        type: "ALXPEndpoint",
        serviceEndpoint: endpoint,
      },
    ];
  }

  return { did, keyPair, document };
}

/** Extract the public key hex from a did:key DID */
export function publicKeyFromDID(did: DID): string {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Cannot extract public key from non did:key DID: ${did}`);
  }
  const hex = did.slice("did:key:z".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`Invalid public key in DID: expected 64 hex chars, got "${hex.slice(0, 20)}..."`);
  }
  return hex;
}

/** In-memory DID resolver for testing */
export class DIDResolver {
  private documents = new Map<DID, DIDDocument>();

  register(did: DID, document: DIDDocument): void {
    this.documents.set(did, document);
  }

  resolve(did: DID): DIDDocument | null {
    // For did:key, we can resolve from the DID itself
    if (did.startsWith("did:key:z")) {
      const pubHex = publicKeyFromDID(did);
      return {
        "@context": "https://www.w3.org/ns/did/v1",
        id: did,
        verificationMethod: [
          {
            id: `${did}#key-1`,
            type: "Ed25519VerificationKey2020",
            controller: did,
            publicKeyHex: pubHex,
          },
        ],
        authentication: [`${did}#key-1`],
        assertionMethod: [`${did}#key-1`],
      };
    }
    return this.documents.get(did) ?? null;
  }
}
