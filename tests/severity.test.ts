import { describe, expect, it } from "vitest";
import { detectContradictions } from "../src/detect/detector.js";
import { classifySeverity, SEVERITY_RULES } from "../src/detect/severity.js";
import { loadKnowledgeBase } from "../src/kb/knowledge-base.js";
import { FIXTURE_PATHS } from "./support/helpers.js";

describe("severity classification", () => {
  it("maps categories to HIGH / MEDIUM / LOW", () => {
    expect(classifySeverity({ predicates: ["approved_reviewer"], type: "status" }).severity).toBe("HIGH");
    expect(classifySeverity({ predicates: ["retired_on", "production_start"], type: "temporal" })).toEqual({
      severity: "HIGH",
      ruleIds: ["SEV-1", "SEV-5"],
    });
    expect(classifySeverity({ predicates: ["primary_database"], type: "direct" }).severity).toBe("MEDIUM");
    expect(
      classifySeverity({ predicates: ["dashboard_count"], type: "numeric", relativeDifference: 0.5 })
        .severity,
    ).toBe("LOW");
  });

  it("downgrades low-impact MEDIUM numeric differences, never HIGH", () => {
    expect(
      classifySeverity({ predicates: ["daily_throughput"], type: "numeric", relativeDifference: 0.05 }),
    ).toEqual({ severity: "LOW", ruleIds: ["SEV-2", "SEV-4"] });
    expect(
      classifySeverity({ predicates: ["daily_throughput"], type: "numeric", relativeDifference: 0.051 })
        .severity,
    ).toBe("MEDIUM");
    expect(
      classifySeverity({ predicates: ["approved_reviewer"], type: "numeric", relativeDifference: 0.001 })
        .severity,
    ).toBe("HIGH");
  });

  it("publishes every rule it can cite", () => {
    const ids: string[] = SEVERITY_RULES.map((r) => r.id);
    const kb = loadKnowledgeBase(FIXTURE_PATHS);
    for (const c of detectContradictions(kb.claims)) {
      for (const rule of c.severityRules) expect(ids).toContain(rule);
    }
  });

  it("covers at least one contradiction per severity level in the fixture", () => {
    const kb = loadKnowledgeBase(FIXTURE_PATHS);
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const c of detectContradictions(kb.claims)) counts[c.severity]++;
    expect(counts).toEqual({ HIGH: 2, MEDIUM: 2, LOW: 2 });
  });
});
