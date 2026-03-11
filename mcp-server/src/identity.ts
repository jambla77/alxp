/**
 * Identity Manager — auto-generates and persists an agent identity.
 *
 * On first run, creates an Ed25519 keypair and DID.
 * On subsequent runs, loads from ~/.alxp/identity.json.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  generateAgentIdentity,
  publicKeyToHex,
  hexToPublicKey,
} from "@alxp/reference";
import type { AgentIdentity } from "@alxp/reference";

interface PersistedIdentity {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

function getDataDir(): string {
  return process.env["ALXP_DATA_DIR"] ?? join(homedir(), ".alxp");
}

function getIdentityPath(): string {
  return join(getDataDir(), "identity.json");
}

/** Load or create the agent identity */
export async function loadOrCreateIdentity(endpoint?: string): Promise<AgentIdentity> {
  const identityPath = getIdentityPath();

  try {
    const raw = await readFile(identityPath, "utf-8");
    const persisted: PersistedIdentity = JSON.parse(raw);

    const publicKey = hexToPublicKey(persisted.publicKeyHex);
    const privateKey = hexToPublicKey(persisted.privateKeyHex); // same hex->bytes conversion

    return {
      did: persisted.did as AgentIdentity["did"],
      keyPair: { publicKey, privateKey },
      document: {
        id: persisted.did,
        verificationMethod: [{
          id: `${persisted.did}#key-1`,
          type: "Ed25519VerificationKey2020",
          controller: persisted.did,
          publicKeyHex: persisted.publicKeyHex,
        }],
        service: endpoint ? [{ id: `${persisted.did}#alxp`, type: "ALXPEndpoint", serviceEndpoint: endpoint }] : [],
      },
    } as AgentIdentity;
  } catch {
    // Identity doesn't exist yet — create one
    const identity = generateAgentIdentity(endpoint);

    const persisted: PersistedIdentity = {
      did: identity.did,
      publicKeyHex: publicKeyToHex(identity.keyPair.publicKey),
      privateKeyHex: publicKeyToHex(identity.keyPair.privateKey),
    };

    const dataDir = getDataDir();
    await mkdir(dataDir, { recursive: true });
    await writeFile(identityPath, JSON.stringify(persisted, null, 2), "utf-8");

    return identity;
  }
}
