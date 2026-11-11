import { describe, expect, it } from "vitest";
import { dateInterval, detectContradictions } from "../src/detect/detector.js";
import { loadKnowledgeBase } from "../src/kb/knowledge-base.js";
import { claim, FIXTURE_PATHS } from "./support/helpers.js";

describe("detector on hand-built claims", () => {
  it("flags a direct factual conflict on a single-valued predicate", () => {
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "primary_database", value: { kind: "string", value: "postgresql" } }),
      claim({ id: "CLM-B", predicate: "primary_database", value: { kind: "string", value: "mysql" } }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.type).toBe("direct");
  });

  it("flags a temporal conflict across predicates linked by an ordering rule", () => {
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "retired_on", value: { kind: "date", value: "2026-03" } }),
      claim({ id: "CLM-B", predicate: "production_start", value: { kind: "date", value: "2026-07" } }),
    ]);
    expect(found.map((c) => c.type)).toEqual(["temporal"]);
    expect(found[0]!.explanation).toContain("ORD-1");
  });

  it("accepts a valid lifecycle (production before retirement)", () => {
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "production_start", value: { kind: "date", value: "2026-01" } }),
      claim({ id: "CLM-B", predicate: "retired_on", value: { kind: "date", value: "2026-03-15" } }),
    ]);
    expect(found).toEqual([]);
  });

  it("flags a same-predicate date conflict but not a refinement", () => {
    const conflict = detectContradictions([
      claim({ id: "CLM-A", predicate: "migration_completed_on", value: { kind: "date", value: "2026-05" } }),
      claim({
        id: "CLM-B",
        predicate: "migration_completed_on",
        value: { kind: "date", value: "2026-06-02" },
      }),
    ]);
    expect(conflict.map((c) => c.type)).toEqual(["temporal"]);
    const refinement = detectContradictions([
      claim({ id: "CLM-A", predicate: "migration_completed_on", value: { kind: "date", value: "2026-05" } }),
      claim({
        id: "CLM-B",
        predicate: "migration_completed_on",
        value: { kind: "date", value: "2026-05-31" },
      }),
    ]);
    expect(refinement).toEqual([]);
  });

  it("flags a numeric conflict and reports the relative difference", () => {
    const unit = "records_per_day";
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "daily_throughput", value: { kind: "number", value: 10000 }, unit }),
      claim({ id: "CLM-B", predicate: "daily_throughput", value: { kind: "number", value: 25000 }, unit }),
    ]);
    expect(found[0]!.type).toBe("numeric");
    expect(found[0]!.explanation).toContain("60.0%");
  });

  it("flags a negation/status conflict", () => {
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "approved_reviewer", value: { kind: "boolean", value: true } }),
      claim({ id: "CLM-B", predicate: "approved_reviewer", value: { kind: "boolean", value: false } }),
    ]);
    expect(found.map((c) => [c.type, c.severity])).toEqual([["status", "HIGH"]]);
  });

  it("does not flag compatible facts on a multi-valued predicate", () => {
    const found = detectContradictions([
      claim({ id: "CLM-A", predicate: "uses_datastore", value: { kind: "string", value: "postgresql" } }),
      claim({ id: "CLM-B", predicate: "uses_datastore", value: { kind: "string", value: "redis" } }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not compare different predicates without an ordering rule, even with negated wording", () => {
    const found = detectContradictions([
      claim({
        id: "CLM-A",
        predicate: "approved_reviewer",
        value: { kind: "boolean", value: false },
        originalText: "X is not an approved reviewer.",
      }),
      claim({
        id: "CLM-B",
        predicate: "on_call_rotation",
        value: { kind: "boolean", value: false },
        originalText: "X is not on the on-call rotation.",
      }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not compare claims about different subjects", () => {
    const found = detectContradictions([
      claim({
        id: "CLM-A",
        subject: "project:a",
        predicate: "primary_database",
        value: { kind: "string", value: "postgresql" },
      }),
      claim({
        id: "CLM-B",
        subject: "project:b",
        predicate: "primary_database",
        value: { kind: "string", value: "mysql" },
      }),
    ]);
    expect(found).toEqual([]);
  });

  it("ignores superseded and obsolete claims, and honours confirmed time scoping", () => {
    const base = { predicate: "daily_throughput", unit: "records_per_day" } as const;
    expect(
      detectContradictions([
        claim({ ...base, id: "CLM-A", value: { kind: "number", value: 1 }, status: "superseded" }),
        claim({ ...base, id: "CLM-B", value: { kind: "number", value: 2 } }),
      ]),
    ).toEqual([]);
    expect(
      detectContradictions([
        claim({ ...base, id: "CLM-A", value: { kind: "number", value: 1 }, asOf: "2026-02-14" }),
        claim({ ...base, id: "CLM-B", value: { kind: "number", value: 2 }, asOf: "2026-09-03" }),
      ]),
    ).toEqual([]);
  });

  it("does not let time scoping hide a conflict on a predicate that is not time-varying", () => {
    const found = detectContradictions([
      claim({
        id: "CLM-A",
        predicate: "primary_database",
        value: { kind: "string", value: "postgresql" },
        asOf: "2026-01",
      }),
      claim({
        id: "CLM-B",
        predicate: "primary_database",
        value: { kind: "string", value: "mysql" },
        asOf: "2026-02",
      }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("reports under-review when both claims are disputed", () => {
    const found = detectContradictions([
      claim({
        id: "CLM-A",
        predicate: "approved_reviewer",
        value: { kind: "boolean", value: true },
        status: "disputed",
      }),
      claim({
        id: "CLM-B",
        predicate: "approved_reviewer",
        value: { kind: "boolean", value: false },
        status: "disputed",
      }),
    ]);
    expect(found[0]!.state).toBe("under-review");
  });

  it("computes month intervals including leap years", () => {
    expect(dateInterval("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(dateInterval("2026-03-15")).toEqual({ start: "2026-03-15", end: "2026-03-15" });
  });
});

describe("detector on the synthetic fixture KB", () => {
  const kb = loadKnowledgeBase(FIXTURE_PATHS);
  const found = detectContradictions(kb.claims);
  const pairs = found.map((c) => c.claimIds.join("+"));

  it("finds exactly the six intentional contradictions", () => {
    expect([...pairs].sort()).toEqual([
      "CLM-ACME-001+CLM-ACME-003",
      "CLM-ATLAS-001+CLM-ATLAS-003",
      "CLM-ATLAS-002+CLM-ATLAS-004",
      "CLM-HARBOR-001+CLM-HARBOR-003",
      "CLM-HARBOR-002+CLM-HARBOR-004",
      "CLM-MIRA-001+CLM-MIRA-003",
    ]);
  });

  it("does not flag the PostgreSQL-for-transactions / Redis-for-caching pair", () => {
    expect(pairs.some((p) => p.includes("LEDGER"))).toBe(false);
  });

  it("produces complete records with source references", () => {
    for (const c of found) {
      expect(c.id).toMatch(/^CTR-[0-9a-f]{8}$/);
      expect(c.sourceRefs.map((r) => r.claimId)).toEqual(c.claimIds);
      expect(c.explanation.length).toBeGreaterThan(20);
      expect(c.confidence).toBeGreaterThan(0);
    }
  });
});
