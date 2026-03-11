/**
 * Task solvers — actual computation functions used by workers.
 */

export function solveTask(input: unknown): { result: unknown; valid: boolean } {
  const data = input as Record<string, unknown>;
  if ("a" in data && "b" in data && "op" in data) {
    return solveMath(data as { a: number; b: number; op: string });
  }
  if ("text" in data && "op" in data) {
    return solveString(data as { text: string; op: string });
  }
  if ("kind" in data && "data" in data) {
    return solveSorting(data as { kind: string; data: unknown[] });
  }
  return { result: null, valid: false };
}

function solveMath(input: { a: number; b: number; op: string }): { result: number; valid: boolean } {
  const { a, b, op } = input;
  switch (op) {
    case "+": return { result: a + b, valid: true };
    case "-": return { result: a - b, valid: true };
    case "*": return { result: a * b, valid: true };
    default: return { result: 0, valid: false };
  }
}

function solveString(input: { text: string; op: string }): { result: unknown; valid: boolean } {
  const { text, op } = input;
  switch (op) {
    case "reverse": return { result: [...text].reverse().join(""), valid: true };
    case "uppercase": return { result: text.toUpperCase(), valid: true };
    case "word-count": return { result: text.split(/\s+/).filter(Boolean).length, valid: true };
    default: return { result: null, valid: false };
  }
}

function solveSorting(input: { kind: string; data: unknown[] }): { result: unknown; valid: boolean } {
  const { kind, data } = input;
  if (kind === "numbers") {
    return { result: [...(data as number[])].sort((a, b) => a - b), valid: true };
  }
  return { result: [...(data as string[])].sort(), valid: true };
}

/** Verify a task result matches expected output */
export function verifyResult(input: unknown, result: unknown): boolean {
  const expected = solveTask(input);
  if (!expected.valid) return false;
  return JSON.stringify(expected.result) === JSON.stringify(result);
}
