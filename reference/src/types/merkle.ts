import { z } from "zod";
import { ISO8601 } from "./primitives.js";

/** A node in the merkle provenance tree */
export const MerkleNode = z.object({
  hash: z.string(),
  type: z.enum([
    "root",
    "input",
    "tool-call",
    "intermediate",
    "output",
    "subtask",
    "metadata",
  ]),
  label: z.string().optional(),
  children: z.array(z.string()).default([]),
  timestamp: ISO8601.optional(),
});
export type MerkleNode = z.infer<typeof MerkleNode>;

/** A complete merkle provenance tree */
export const MerkleProvenanceTree = z.object({
  rootHash: z.string(),
  nodes: z.record(z.string(), MerkleNode),
  contractId: z.string(),
  builder: z.string(),
});
export type MerkleProvenanceTree = z.infer<typeof MerkleProvenanceTree>;
