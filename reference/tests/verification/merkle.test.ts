import { describe, it, expect } from "vitest";
import { MerkleTreeBuilder } from "../../src/verification/merkle.js";

describe("MerkleTreeBuilder", () => {
  it("builds a tree from inputs, steps, and outputs", () => {
    const builder = new MerkleTreeBuilder("contract-01", "did:key:zWorker");

    const i1 = builder.addLeaf("input", { text: "Hello world" }, "input-1");
    const i2 = builder.addLeaf("input", { text: "More context" }, "input-2");
    const inputsBranch = builder.addBranch("input", [i1, i2], "all-inputs");

    const s1 = builder.addLeaf("tool-call", { tool: "search", result: "found" }, "step-1");
    const s2 = builder.addLeaf("tool-call", { tool: "summarize", result: "summary" }, "step-2");
    const stepsBranch = builder.addBranch("intermediate", [s1, s2], "execution-steps");

    const o1 = builder.addLeaf("output", { text: "Final answer" }, "output-1");
    const outputsBranch = builder.addBranch("output", [o1], "all-outputs");

    const tree = builder.build([inputsBranch, stepsBranch, outputsBranch]);

    expect(tree.rootHash).toBeTruthy();
    expect(tree.contractId).toBe("contract-01");
    expect(tree.builder).toBe("did:key:zWorker");
    expect(Object.keys(tree.nodes).length).toBe(9); // 5 leaves + 3 branches + 1 root
    expect(tree.nodes[tree.rootHash]!.type).toBe("root");
  });

  it("verifies tree integrity for valid tree", () => {
    const builder = new MerkleTreeBuilder("contract-02", "did:key:zWorker");

    const leaf = builder.addLeaf("input", "test data", "leaf-1");
    const tree = builder.build([leaf]);

    expect(MerkleTreeBuilder.verifyTree(tree)).toBe(true);
  });

  it("fails verification for tampered tree (missing child)", () => {
    const builder = new MerkleTreeBuilder("contract-03", "did:key:zWorker");

    const leaf = builder.addLeaf("input", "test data", "leaf-1");
    const tree = builder.build([leaf]);

    // Tamper: remove the leaf node
    delete tree.nodes[leaf];

    expect(MerkleTreeBuilder.verifyTree(tree)).toBe(false);
  });

  it("fails verification for tree with missing root", () => {
    const tree = {
      rootHash: "nonexistent-hash",
      nodes: {},
      contractId: "contract-04",
      builder: "did:key:zWorker",
    };

    expect(MerkleTreeBuilder.verifyTree(tree)).toBe(false);
  });

  it("verifies node inclusion", () => {
    const builder = new MerkleTreeBuilder("contract-05", "did:key:zWorker");

    const leaf = builder.addLeaf("input", "test data", "leaf-1");
    const tree = builder.build([leaf]);

    expect(MerkleTreeBuilder.verifyInclusion(tree, leaf)).toBe(true);
    expect(MerkleTreeBuilder.verifyInclusion(tree, "nonexistent")).toBe(false);
  });

  it("includes subtask merkle roots as leaves", () => {
    const builder = new MerkleTreeBuilder("contract-06", "did:key:zWorker");

    const input = builder.addLeaf("input", "task input", "input");
    const subtask1 = builder.addLeaf("subtask", "subtask-merkle-root-abc123", "subtask-1");
    const subtask2 = builder.addLeaf("subtask", "subtask-merkle-root-def456", "subtask-2");
    const output = builder.addLeaf("output", "combined result", "output");

    const tree = builder.build([input, subtask1, subtask2, output]);

    expect(MerkleTreeBuilder.verifyTree(tree)).toBe(true);
    expect(MerkleTreeBuilder.verifyInclusion(tree, subtask1)).toBe(true);
    expect(MerkleTreeBuilder.verifyInclusion(tree, subtask2)).toBe(true);
  });

  it("handles tree with only a root (no children)", () => {
    const builder = new MerkleTreeBuilder("contract-07", "did:key:zWorker");
    const tree = builder.build([]);

    expect(tree.rootHash).toBeTruthy();
    expect(MerkleTreeBuilder.verifyTree(tree)).toBe(true);
  });

  it("produces deterministic hashes for same content", () => {
    const builder1 = new MerkleTreeBuilder("c1", "w1");
    const builder2 = new MerkleTreeBuilder("c2", "w2");

    const hash1 = builder1.addLeaf("input", { key: "value" }, "test");
    const hash2 = builder2.addLeaf("input", { key: "value" }, "test");

    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const builder = new MerkleTreeBuilder("c1", "w1");

    const hash1 = builder.addLeaf("input", "content A");
    const hash2 = builder.addLeaf("input", "content B");

    expect(hash1).not.toBe(hash2);
  });
});
