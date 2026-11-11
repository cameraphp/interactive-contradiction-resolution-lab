import { detectContradictions } from "../detect/detector.js";
import type { Contradiction } from "../domain/schemas.js";
import type { KnowledgeBase, StructuralFinding } from "../kb/knowledge-base.js";
import { contentPages } from "../kb/knowledge-base.js";
import { hashOf } from "../util/hash.js";

export interface LintReport {
  counts: { sources: number; pages: number; claims: number; liveClaims: number };
  contradictions: Contradiction[];
  structural: StructuralFinding[];
  /** Hash of the findings only, so two runs over identical content compare equal. */
  fingerprint: string;
}

export function lint(kb: KnowledgeBase): LintReport {
  const contradictions = detectContradictions(kb.claims);
  const structural = kb.findings;
  return {
    counts: {
      sources: kb.sources.size,
      pages: contentPages(kb.pages).length,
      claims: kb.claims.length,
      liveClaims: kb.claims.filter((c) => c.status === "active" || c.status === "disputed").length,
    },
    contradictions,
    structural,
    fingerprint: hashOf({ contradictions, structural }),
  };
}

export interface LintDelta {
  resolved: string[];
  introduced: string[];
  persisting: string[];
  newlyUnderReview: string[];
  structuralErrorsIntroduced: string[];
  /** True when nothing new appeared. Persisting contradictions do not make a regression lint fail. */
  ok: boolean;
}

function structuralKey(f: StructuralFinding): string {
  return `${f.code}|${f.page ?? ""}|${f.claimId ?? ""}|${f.sourceId ?? ""}|${f.message}`;
}

export function compareLint(before: LintReport, after: LintReport): LintDelta {
  const beforeIds = new Map(before.contradictions.map((c) => [c.id, c]));
  const afterIds = new Map(after.contradictions.map((c) => [c.id, c]));
  const resolved = [...beforeIds.keys()].filter((id) => !afterIds.has(id)).sort();
  const introduced = [...afterIds.keys()].filter((id) => !beforeIds.has(id)).sort();
  const persisting = [...afterIds.keys()].filter((id) => beforeIds.has(id)).sort();
  const newlyUnderReview = persisting
    .filter((id) => beforeIds.get(id)!.state === "open" && afterIds.get(id)!.state === "under-review")
    .sort();
  const beforeErrors = new Set(before.structural.filter((f) => f.level === "error").map(structuralKey));
  const structuralErrorsIntroduced = after.structural
    .filter((f) => f.level === "error" && !beforeErrors.has(structuralKey(f)))
    .map(structuralKey)
    .sort();
  return {
    resolved,
    introduced,
    persisting,
    newlyUnderReview,
    structuralErrorsIntroduced,
    ok: introduced.length === 0 && structuralErrorsIntroduced.length === 0,
  };
}
