import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalize } from "../messages/canonicalize.js";
import type { ResultBundle, AcceptanceCriteria, TaskSpec } from "../types/index.js";

/** Result of running a single verification check */
export interface CheckResult {
  criteriaType: AcceptanceCriteria["type"];
  passed: boolean;
  details: string;
  durationMs: number;
}

/** Result of running all automated checks */
export interface AutomatedVerificationResult {
  passed: boolean;
  checks: CheckResult[];
  score: number;
  timestamp: string;
}

/**
 * Run all automated verification checks against a ResultBundle.
 *
 * Checks are run in order. Each check is independent.
 * The overall result passes only if ALL checks pass.
 */
export async function runAutomatedVerification(
  result: ResultBundle,
  taskSpec: TaskSpec,
): Promise<AutomatedVerificationResult> {
  const checks: CheckResult[] = [];

  for (const criteria of taskSpec.acceptanceCriteria) {
    const start = Date.now();
    let check: CheckResult;

    switch (criteria.type) {
      case "schema":
        check = runSchemaCheck(result, criteria.schema);
        break;
      case "hash":
        check = runHashCheck(result, criteria.expectedHash);
        break;
      case "test":
        check = runTestSuite(result, criteria.testSuite);
        break;
      default:
        // Non-automated criteria (rubric, consensus, human, optimistic)
        // are handled by higher tiers
        continue;
    }

    check.durationMs = Date.now() - start;
    checks.push(check);
  }

  const passed = checks.length > 0 && checks.every((c) => c.passed);
  const score = checks.length > 0 ? checks.filter((c) => c.passed).length / checks.length : 0;

  return {
    passed,
    checks,
    score,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate result outputs against a JSON Schema (simplified).
 *
 * For text/plain outputs: checks that data is a non-empty string.
 * For application/json outputs: parses JSON and validates against schema.
 * Schema validation supports: { type: "string" | "object" | "array" | "number" },
 * plus { required: string[] } and { properties: { key: { type } } } for objects.
 */
function runSchemaCheck(
  result: ResultBundle,
  schema: Record<string, unknown>,
): CheckResult {
  const errors: string[] = [];

  for (const output of result.outputs) {
    if (output.mimeType === "application/json" || output.mimeType.endsWith("+json")) {
      try {
        const parsed = JSON.parse(output.data);
        const schemaErrors = validateAgainstSchema(parsed, schema);
        errors.push(...schemaErrors.map((e) => `${output.name}: ${e}`));
      } catch {
        errors.push(`${output.name}: invalid JSON`);
      }
    } else {
      // For text outputs, validate against schema type
      const expectedType = schema["type"];
      if (expectedType === "string") {
        if (typeof output.data !== "string" || output.data.length === 0) {
          errors.push(`${output.name}: expected non-empty string`);
        }
      } else if (expectedType === "object" || expectedType === "array") {
        // Text output can't satisfy object/array schema
        errors.push(`${output.name}: text output cannot satisfy ${expectedType} schema`);
      }
      // If no type specified or type is "string", text is valid
    }
  }

  return {
    criteriaType: "schema",
    passed: errors.length === 0,
    details: errors.length === 0 ? "All outputs match schema" : errors.join("; "),
    durationMs: 0,
  };
}

function validateAgainstSchema(value: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const expectedType = schema["type"] as string | undefined;

  if (expectedType) {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (expectedType === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`expected integer, got ${actualType}`);
        return errors;
      }
    } else if (actualType !== expectedType) {
      errors.push(`expected ${expectedType}, got ${actualType}`);
      return errors;
    }
  }

  // Object property checks
  if (expectedType === "object" && typeof value === "object" && value !== null) {
    const required = schema["required"] as string[] | undefined;
    if (required) {
      for (const key of required) {
        if (!(key in (value as Record<string, unknown>))) {
          errors.push(`missing required property: ${key}`);
        }
      }
    }
    const properties = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in (value as Record<string, unknown>)) {
          const propErrors = validateAgainstSchema(
            (value as Record<string, unknown>)[key],
            propSchema,
          );
          errors.push(...propErrors.map((e) => `${key}: ${e}`));
        }
      }
    }
  }

  return errors;
}

/**
 * Check that the SHA-256 hash of the output matches the expected hash.
 *
 * Uses JCS canonicalization to ensure deterministic hashing.
 */
function runHashCheck(
  result: ResultBundle,
  expectedHash: string,
): CheckResult {
  const allData = result.outputs.map((o) => o.data).join("");
  const canonical = canonicalize(allData);
  const hash = bytesToHex(sha256(new TextEncoder().encode(canonical)));

  return {
    criteriaType: "hash",
    passed: hash === expectedHash,
    details: hash === expectedHash
      ? "Hash matches"
      : `Hash mismatch: expected ${expectedHash}, got ${hash}`,
    durationMs: 0,
  };
}

/**
 * Execute a test suite against the result.
 *
 * Supported checks:
 * - "contains:<string>" — output must contain the string
 * - "min-length:<number>" — output must be at least N characters
 * - "max-length:<number>" — output must be at most N characters
 * - "regex:<pattern>" — output must match the regex
 * - "json-valid" — output must be valid JSON
 *
 * Multiple checks separated by semicolons: "json-valid;min-length:100"
 */
function runTestSuite(
  result: ResultBundle,
  testSuite: string,
): CheckResult {
  const allData = result.outputs.map((o) => o.data).join("");
  const checks = testSuite.split(";").map((s) => s.trim()).filter(Boolean);
  const failures: string[] = [];

  for (const check of checks) {
    if (check === "json-valid") {
      try {
        JSON.parse(allData);
      } catch {
        failures.push("output is not valid JSON");
      }
    } else if (check.startsWith("contains:")) {
      const needle = check.slice("contains:".length);
      if (!allData.includes(needle)) {
        failures.push(`output does not contain "${needle}"`);
      }
    } else if (check.startsWith("min-length:")) {
      const minLen = parseInt(check.slice("min-length:".length), 10);
      if (allData.length < minLen) {
        failures.push(`output length ${allData.length} < minimum ${minLen}`);
      }
    } else if (check.startsWith("max-length:")) {
      const maxLen = parseInt(check.slice("max-length:".length), 10);
      if (allData.length > maxLen) {
        failures.push(`output length ${allData.length} > maximum ${maxLen}`);
      }
    } else if (check.startsWith("regex:")) {
      const pattern = check.slice("regex:".length);
      try {
        const re = new RegExp(pattern);
        if (!re.test(allData)) {
          failures.push(`output does not match regex /${pattern}/`);
        }
      } catch {
        failures.push(`invalid regex pattern: ${pattern}`);
      }
    } else {
      failures.push(`unknown test check: ${check}`);
    }
  }

  return {
    criteriaType: "test",
    passed: failures.length === 0,
    details: failures.length === 0 ? "All test checks passed" : failures.join("; "),
    durationMs: 0,
  };
}
