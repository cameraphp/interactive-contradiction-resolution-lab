import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Line endings are normalised before hashing so a Git checkout with autocrlf does not look like tampering.
 * Any other byte change (including whitespace inside a line) still changes the hash.
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** JSON with recursively sorted object keys, so equal values always hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function hashOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
