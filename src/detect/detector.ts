import { ORDERING_RULES, PREDICATES, type OrderingRule } from "../domain/predicates.js";
import {
  SEVERITY_ORDER,
  type Claim,
  type Contradiction,
  type ContradictionType,
  type ProposalAction,
} from "../domain/schemas.js";
import { sha256 } from "../util/hash.js";
import { classifySeverity } from "./severity.js";

/** Superseded and obsolete claims are history, not current knowledge. */
export function isLive(claim: Claim): boolean {
  return claim.status === "active" || claim.status === "disputed";
}

/** "2026-03" covers the whole month; "2026-03-15" a single day. Returned as inclusive ISO day bounds. */
export function dateInterval(value: string): { start: string; end: string } {
  if (value.length === 10) return { start: value, end: value };
  const [y, m] = value.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${value}-01`, end: `${value}-${String(lastDay).padStart(2, "0")}` };
}

export function relativeDifference(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
}

export function contradictionId(claimIds: string[]): string {
  return `CTR-${sha256([...claimIds].sort().join("|")).slice(0, 8)}`;
}

interface Finding {
  type: ContradictionType;
  explanation: string;
  relativeDifference?: number;
  rule?: OrderingRule;
}

function show(c: Claim): string {
  return `${c.id} (${c.sourceId}, ${c.sourceDate ?? "undated"})`;
}

function compareSamePredicate(a: Claim, b: Claim): Finding | null {
  const spec = PREDICATES[a.predicate]!;
  if (spec.cardinality === "many") return null;
  // Time-scoped claims: a human has confirmed each value applies to a different point in time.
  if (spec.timeVarying && a.asOf && b.asOf && a.asOf !== b.asOf) return null;

  const label = spec.label;
  const va = a.value;
  const vb = b.value;
  if (va.kind === "number" && vb.kind === "number") {
    if (va.value === vb.value) return null;
    const rel = relativeDifference(va.value, vb.value);
    const unit = spec.unit ? ` ${spec.unit}` : "";
    return {
      type: "numeric",
      relativeDifference: rel,
      explanation: `"${label}" has one value, but ${show(a)} says ${va.value}${unit} and ${show(b)} says ${vb.value}${unit} (relative difference ${(rel * 100).toFixed(1)}%).`,
    };
  }
  if (va.kind === "date" && vb.kind === "date") {
    const ia = dateInterval(va.value);
    const ib = dateInterval(vb.value);
    if (ia.start <= ib.end && ib.start <= ia.end) return null; // overlapping precision = refinement, not conflict
    return {
      type: "temporal",
      explanation: `"${label}" has one date, but ${show(a)} says ${va.value} and ${show(b)} says ${vb.value}; the periods do not overlap.`,
    };
  }
  if (va.kind === "boolean" && vb.kind === "boolean") {
    if (va.value === vb.value) return null;
    return {
      type: "status",
      explanation: `${show(a)} asserts "${label}" is ${va.value}; ${show(b)} asserts it is ${vb.value}. One claim negates the other.`,
    };
  }
  if (va.kind === "string" && vb.kind === "string") {
    if (va.value === vb.value) return null;
    return {
      type: "direct",
      explanation: `"${label}" has one value, but ${show(a)} says "${va.value}" and ${show(b)} says "${vb.value}".`,
    };
  }
  return null;
}

function compareOrdering(a: Claim, b: Claim): Finding | null {
  for (const rule of ORDERING_RULES) {
    const earlier = a.predicate === rule.earlier ? a : b.predicate === rule.earlier ? b : null;
    const later = a.predicate === rule.later ? a : b.predicate === rule.later ? b : null;
    if (!earlier || !later || earlier === later) continue;
    if (earlier.value.kind !== "date" || later.value.kind !== "date") continue;
    const earliestStart = dateInterval(earlier.value.value).start;
    const latestEnd = dateInterval(later.value.value).end;
    if (earliestStart > latestEnd) {
      return {
        type: "temporal",
        rule,
        explanation: `${show(later)} says "${PREDICATES[later.predicate]!.label}" ${later.value.value} (no later than ${latestEnd}), but ${show(earlier)} says "${PREDICATES[earlier.predicate]!.label}" ${earlier.value.value} (no earlier than ${earliestStart}). Rule ${rule.id}: ${rule.description}`,
      };
    }
  }
  return null;
}

/** Chronological order: older source first. Undated claims sort first; ties break on claim id. */
export function byAge(a: Claim, b: Claim): number {
  return (a.sourceDate ?? "").localeCompare(b.sourceDate ?? "") || a.id.localeCompare(b.id);
}

function recommend(severity: string, a: Claim, b: Claim, crossPredicate: boolean): ProposalAction {
  if (severity === "HIGH") return "request-human-review";
  const datesDiffer = a.sourceDate !== null && b.sourceDate !== null && a.sourceDate !== b.sourceDate;
  if (!datesDiffer) return "request-new-source";
  if (crossPredicate) return "mark-obsolete";
  if (PREDICATES[a.predicate]!.timeVarying) return "preserve-both-temporal";
  return "keep-newer";
}

export function detectContradictions(claims: Claim[]): Contradiction[] {
  const live = claims.filter(isLive).sort((x, y) => x.id.localeCompare(y.id));
  const found: Contradiction[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i]!, live[j]!].sort(byAge) as [Claim, Claim];
      if (a.subject !== b.subject) continue;
      const crossPredicate = a.predicate !== b.predicate;
      const finding = crossPredicate ? compareOrdering(a, b) : compareSamePredicate(a, b);
      if (!finding) continue;

      const predicates = [...new Set([a.predicate, b.predicate])];
      const sev = classifySeverity({
        predicates,
        type: finding.type,
        ...(finding.relativeDifference !== undefined
          ? { relativeDifference: finding.relativeDifference }
          : {}),
      });
      // Cross-predicate ordering is a modelling assumption, so it carries slightly less confidence.
      const ruleConfidence = crossPredicate ? 0.9 : 1;
      found.push({
        id: contradictionId([a.id, b.id]),
        claimIds: [a.id, b.id],
        subject: a.subject,
        predicates,
        type: finding.type,
        explanation: finding.explanation,
        confidence: Math.round(Math.min(a.confidence, b.confidence) * ruleConfidence * 100) / 100,
        severity: sev.severity,
        severityRules: sev.ruleIds,
        sourceRefs: [a, b].map((c) => ({
          claimId: c.id,
          sourceId: c.sourceId,
          line: c.sourceLocation.line,
          sourceDate: c.sourceDate,
          page: c.pageRef,
        })),
        recommendedAction: recommend(sev.severity, a, b, crossPredicate),
        state: a.status === "disputed" && b.status === "disputed" ? "under-review" : "open",
      });
    }
  }
  return found.sort(
    (x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || x.id.localeCompare(y.id),
  );
}
