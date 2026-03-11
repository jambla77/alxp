/**
 * RFC 8785 (JCS) — JSON Canonicalization Scheme.
 *
 * Deterministic JSON serialization for signing.
 * Keys are sorted lexicographically, undefined values are omitted.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) {
        entries.push(`${JSON.stringify(key)}:${canonicalize(val)}`);
      }
    }
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}
