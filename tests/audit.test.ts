import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/util/clock.js";
import { appendAuditEvent, AuditTamperError, GENESIS_HASH, verifyAuditLog } from "../src/workflow/audit.js";
import { cleanupTemps, tempDir } from "./support/helpers.js";

afterEach(cleanupTemps);

const base = {
  actor: "tester",
  contradictionId: null,
  proposalId: null,
  sourceClaimIds: [],
  oldContentHash: null,
  newContentHash: null,
  proposalHash: null,
  diffHash: null,
  result: "success" as const,
};

function seeded(n = 4): string {
  const path = join(tempDir(), "audit.jsonl");
  const clock = fixedClock();
  for (let i = 0; i < n; i++)
    appendAuditEvent(path, { ...base, operation: "lint.relint", reason: `event ${i}` }, clock);
  return path;
}

function lines(path: string): string[] {
  return readFileSync(path, "utf8").trim().split("\n");
}

describe("hash-chained audit log", () => {
  it("chains each event to the previous hash, starting from genesis", () => {
    const path = seeded();
    const { ok, events, headHash } = verifyAuditLog(path);
    expect(ok).toBe(true);
    expect(events[0]!.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i++) expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
    expect(headHash).toBe(events[events.length - 1]!.hash);
  });

  it("detects an edited event", () => {
    const path = seeded();
    const l = lines(path);
    l[1] = l[1]!.replace("event 1", "event one");
    writeFileSync(path, `${l.join("\n")}\n`);
    const v = verifyAuditLog(path);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("line 2: content does not match its hash");
  });

  it("detects a deleted event and a reordering", () => {
    const deleted = seeded();
    const l = lines(deleted);
    writeFileSync(deleted, `${[l[0], l[2], l[3]].join("\n")}\n`);
    expect(verifyAuditLog(deleted).ok).toBe(false);

    const reordered = seeded();
    const r = lines(reordered);
    writeFileSync(reordered, `${[r[0], r[2], r[1], r[3]].join("\n")}\n`);
    expect(verifyAuditLog(reordered).ok).toBe(false);
  });

  it("refuses to append to a tampered log (fail closed)", () => {
    const path = seeded();
    writeFileSync(path, readFileSync(path, "utf8").replace("event 0", "event zero"));
    expect(() =>
      appendAuditEvent(path, { ...base, operation: "lint.relint", reason: "x" }, fixedClock()),
    ).toThrow(AuditTamperError);
  });

  it("documents its limit: silent truncation of the newest events is not detectable without an external anchor", () => {
    const path = seeded();
    const anchor = verifyAuditLog(path).headHash;
    const l = lines(path);
    writeFileSync(path, `${l.slice(0, 2).join("\n")}\n`);
    const v = verifyAuditLog(path);
    expect(v.ok).toBe(true); // the chain itself is still internally consistent
    expect(v.headHash).not.toBe(anchor); // only a head hash kept elsewhere reveals the truncation
  });
});
