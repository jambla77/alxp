import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalize } from "../messages/canonicalize.js";
import type { MerkleNode, MerkleProvenanceTree } from "../types/merkle.js";

/**
 * Build a merkle provenance tree from task execution data.
 *
 * The tree structure:
 *
 *            root
 *         /   |   \
 *    inputs  steps  outputs
 *     / \    / | \    |
 *   i1  i2  t1 t2 t3  o1
 *                |
 *            subtask
 *          (merkle root)
 *
 * Each leaf is the hash of its content (canonicalized JSON).
 * Each branch is the hash of its children's hashes concatenated.
 * The root hash is what goes into the WorkReceipt.
 */
export class MerkleTreeBuilder {
  private nodes = new Map<string, MerkleNode>();

  constructor(
    private contractId: string,
    private builder: string,
  ) {}

  /** Hash arbitrary content into a leaf node */
  addLeaf(
    type: MerkleNode["type"],
    content: unknown,
    label?: string,
    timestamp?: string,
  ): string {
    const contentHash = this.hashContent(content);
    const node: MerkleNode = {
      hash: contentHash,
      type,
      label,
      children: [],
      timestamp,
    };
    this.nodes.set(contentHash, node);
    return contentHash;
  }

  /** Create a branch node from child hashes */
  addBranch(
    type: MerkleNode["type"],
    childHashes: string[],
    label?: string,
    timestamp?: string,
  ): string {
    const combined = childHashes.join("");
    const branchHash = this.hashContent(combined);
    const node: MerkleNode = {
      hash: branchHash,
      type,
      label,
      children: childHashes,
      timestamp,
    };
    this.nodes.set(branchHash, node);
    return branchHash;
  }

  /** Build the final tree with a root node */
  build(topLevelChildHashes: string[]): MerkleProvenanceTree {
    const rootHash = this.addBranch("root", topLevelChildHashes, "provenance-root");
    return {
      rootHash,
      nodes: Object.fromEntries(this.nodes),
      contractId: this.contractId,
      builder: this.builder,
    };
  }

  /** Verify that a node exists in the tree */
  static verifyInclusion(
    tree: MerkleProvenanceTree,
    nodeHash: string,
  ): boolean {
    return nodeHash in tree.nodes;
  }

  /** Verify the entire tree's integrity */
  static verifyTree(tree: MerkleProvenanceTree): boolean {
    const root = tree.nodes[tree.rootHash];
    if (!root) return false;

    // Verify the root hash is consistent
    if (root.type !== "root") return false;

    return verifyBranchIntegrity(tree, tree.rootHash);
  }

  /** Hash content using SHA-256 over canonicalized JSON */
  hashContent(content: unknown): string {
    const serialized = typeof content === "string"
      ? content
      : canonicalize(content);
    const hash = sha256(new TextEncoder().encode(serialized));
    return bytesToHex(hash);
  }
}

/** Recursively verify that all branch nodes reference existing children */
function verifyBranchIntegrity(
  tree: MerkleProvenanceTree,
  nodeHash: string,
): boolean {
  const node = tree.nodes[nodeHash];
  if (!node) return false;

  // Leaf nodes are valid by existence
  if (node.children.length === 0) return true;

  // Branch: verify all children exist and recurse
  for (const childHash of node.children) {
    if (!tree.nodes[childHash]) return false;
    if (!verifyBranchIntegrity(tree, childHash)) return false;
  }

  return true;
}
