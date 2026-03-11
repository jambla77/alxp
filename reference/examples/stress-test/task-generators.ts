/**
 * Random task generators for the stress test.
 * Three types: math (40%), string transforms (35%), sorting (25%).
 */

export type TaskType = "math" | "string" | "sorting";

export interface GeneratedTask {
  type: TaskType;
  domain: string;
  objective: string;
  input: unknown;
}

// ── Helpers ──

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.trim() || "hello";
}

// ── Math ──

const OPS = ["+", "-", "*"] as const;

function generateMath(): GeneratedTask {
  const a = randInt(1, 1000);
  const b = randInt(1, 1000);
  const op = randChoice([...OPS]);
  return {
    type: "math",
    domain: "computation",
    objective: `Evaluate: ${a} ${op} ${b}`,
    input: { a, b, op },
  };
}

// ── String transforms ──

type StringOp = "reverse" | "uppercase" | "word-count";

function generateString(): GeneratedTask {
  const op = randChoice<StringOp>(["reverse", "uppercase", "word-count"]);
  const text = randString(randInt(10, 200));
  return {
    type: "string",
    domain: "computation",
    objective: `String ${op}: "${text.slice(0, 30)}..."`,
    input: { text, op },
  };
}

// ── Sorting ──

type SortKind = "numbers" | "strings";

function generateSorting(): GeneratedTask {
  const kind = randChoice<SortKind>(["numbers", "strings"]);
  const len = randInt(5, 100);
  if (kind === "numbers") {
    const arr = Array.from({ length: len }, () => randInt(-10000, 10000));
    return {
      type: "sorting",
      domain: "computation",
      objective: `Sort ${len} numbers ascending`,
      input: { kind, data: arr },
    };
  }
  const arr = Array.from({ length: len }, () => randString(randInt(3, 15)));
  return {
    type: "sorting",
    domain: "computation",
    objective: `Sort ${len} strings alphabetically`,
    input: { kind, data: arr },
  };
}

// ── Generator (weighted) ──

export function generateTask(): GeneratedTask {
  const roll = Math.random();
  if (roll < 0.4) return generateMath();
  if (roll < 0.75) return generateString();
  return generateSorting();
}
