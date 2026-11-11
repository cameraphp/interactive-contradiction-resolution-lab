import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { AuditEventSchema, type AuditEvent } from "../domain/schemas.js";
import type { Clock } from "../util/clock.js";
import { hashOf } from "../util/hash.js";

export const GENESIS_HASH = "0".repeat(64);

export type AuditEventInput = Omit<AuditEvent, "seq" | "timestamp" | "prevHash" | "hash">;

export interface AuditVerification {
  ok: boolean;
  events: AuditEvent[];
  headHash: string;
  problems: string[];
}

function eventHash(event: Omit<AuditEvent, "hash">): string {
  return hashOf(event);
}

/**
 * Recompute the chain. Detects edited, deleted, inserted or reordered events. It cannot detect truncation
 * of the newest events, or a fully rewritten chain, unless the head hash was recorded somewhere else.
 */
export function verifyAuditLog(path: string): AuditVerification {
  if (!existsSync(path)) return { ok: true, events: [], headHash: GENESIS_HASH, problems: [] };
  const problems: string[] = [];
  const events: AuditEvent[] = [];
  let prev = GENESIS_HASH;
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  lines.forEach((line, i) => {
    let parsed: AuditEvent;
    try {
      parsed = AuditEventSchema.parse(JSON.parse(line));
    } catch {
      problems.push(`line ${i + 1}: not a valid audit event`);
      return;
    }
    const { hash, ...rest } = parsed;
    if (parsed.seq !== i + 1) problems.push(`line ${i + 1}: expected seq ${i + 1}, found ${parsed.seq}`);
    if (parsed.prevHash !== prev) problems.push(`line ${i + 1}: prevHash does not match the previous event`);
    if (eventHash(rest) !== hash) problems.push(`line ${i + 1}: content does not match its hash`);
    events.push(parsed);
    prev = hash;
  });
  return { ok: problems.length === 0, events, headHash: prev, problems };
}

export class AuditTamperError extends Error {
  constructor(readonly problems: string[]) {
    super(`audit log failed verification: ${problems.join("; ")}`);
  }
}

/** Append-only: verifies the existing chain first and refuses to extend a broken one (fail closed). */
export function appendAuditEvent(path: string, input: AuditEventInput, clock: Clock): AuditEvent {
  const current = verifyAuditLog(path);
  if (!current.ok) throw new AuditTamperError(current.problems);
  const base: Omit<AuditEvent, "hash"> = {
    seq: current.events.length + 1,
    timestamp: clock.now(),
    ...input,
    prevHash: current.headHash,
  };
  const event = AuditEventSchema.parse({ ...base, hash: eventHash(base) });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
