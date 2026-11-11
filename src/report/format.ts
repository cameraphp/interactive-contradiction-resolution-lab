import { PREDICATES } from "../domain/predicates.js";
import type { AuditEvent, Contradiction, Proposal } from "../domain/schemas.js";
import { SEVERITY_RULES } from "../detect/severity.js";
import { formatValue, type KnowledgeBase } from "../kb/knowledge-base.js";
import type { LintDelta, LintReport } from "../lint/lint.js";
import type { AdvisorResult } from "../llm/advisor.js";

const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function severityCounts(cs: Contradiction[]): string {
  return SEVERITIES.map((s) => `${s} ${cs.filter((c) => c.severity === s).length}`).join(", ");
}

export function formatContradictionRow(c: Contradiction): string {
  return [
    pad(c.id, 13),
    pad(c.type, 9),
    pad(c.subject, 17),
    pad(c.predicates.join("/"), 29),
    pad(c.claimIds.join(" vs "), 32),
    `conf ${c.confidence.toFixed(2)}`,
    ...(c.state === "under-review" ? ["[under review]"] : []),
    `-> ${c.recommendedAction}`,
  ].join(" ");
}

export function formatFindingsBySeverity(cs: Contradiction[], indent = "  "): string {
  const out: string[] = [];
  for (const s of SEVERITIES) {
    const group = cs.filter((c) => c.severity === s);
    if (group.length === 0) continue;
    out.push(`${indent}${s}`);
    for (const c of group) out.push(`${indent}  ${formatContradictionRow(c)}`);
  }
  return out.join("\n");
}

export function formatLintReport(r: LintReport): string {
  const errors = r.structural.filter((f) => f.level === "error").length;
  const warnings = r.structural.filter((f) => f.level === "warning").length;
  const infos = r.structural.filter((f) => f.level === "info").length;
  const open = r.contradictions.filter((c) => c.state === "open").length;
  return [
    `Knowledge base: ${r.counts.sources} sources (manifest verified), ${r.counts.pages} pages, ${r.counts.claims} claims (${r.counts.liveClaims} live)`,
    `Contradictions: ${r.contradictions.length} (${open} open, ${r.contradictions.length - open} under review) - ${severityCounts(r.contradictions)}`,
    "",
    formatFindingsBySeverity(r.contradictions),
    "",
    `Structural findings: ${errors} errors, ${warnings} warnings, ${infos} info`,
    ...r.structural.map(
      (f) => `  ${pad(f.level, 7)} ${pad(f.code, 28)} ${pad(f.sourceId ?? f.page ?? "", 24)} ${f.message}`,
    ),
  ].join("\n");
}

export function formatContradictionDetail(
  c: Contradiction,
  kb: KnowledgeBase,
  advisor?: AdvisorResult,
): string {
  const lines = [
    `${c.id}  ${c.severity}  ${c.type}  (${c.state})`,
    `Subject: ${c.subject}   Predicate(s): ${c.predicates.map((p) => `${p} [${PREDICATES[p]?.category}]`).join(", ")}`,
    `Confidence: ${c.confidence.toFixed(2)} (min of claim confidences${c.predicates.length > 1 ? " x 0.9 for a cross-predicate rule" : ""})`,
    "Severity rules applied:",
    ...c.severityRules.map((id) => `  ${id}: ${SEVERITY_RULES.find((r) => r.id === id)?.text}`),
    `Explanation: ${c.explanation}`,
    "",
    "Evidence:",
  ];
  for (const id of c.claimIds) {
    const claim = kb.claims.find((cl) => cl.id === id)!;
    const source = kb.sources.get(claim.sourceId)!;
    lines.push(
      `  [${claim.id}] page ${claim.pageRef}, status ${claim.status}, confidence ${claim.confidence.toFixed(2)}`,
      `    normalized: ${claim.predicate} = ${formatValue(claim.value)}${claim.unit ? ` ${claim.unit}` : ""}`,
      `    source: ${source.id} "${source.title}" (${source.date}), line ${claim.sourceLocation.line}`,
      `    > ${source.lines[claim.sourceLocation.line - 1]}`,
    );
  }
  lines.push("", `Recommended next action: ${c.recommendedAction}`);
  if (advisor) lines.push(formatAdvisor(advisor));
  return lines.join("\n");
}

export function formatAdvisor(a: AdvisorResult): string {
  if (a.status === "disabled") return "Advisor: disabled (the deterministic detector is the authority)";
  if (a.status === "rejected") return `Advisor ${a.advisor}: response REJECTED - ${a.reasons.join("; ")}`;
  return [
    `Advisor ${a.advisor} (advisory only): severity ${a.suggestion.suggestedSeverity}, action ${a.suggestion.suggestedAction}`,
    `  rationale: ${a.suggestion.rationale}`,
    ...a.notes.map((n) => `  note: ${n}`),
  ].join("\n");
}

export function formatProposalSummary(p: Proposal, state: string): string {
  return `${p.id}  ${pad(p.action, 22)} ${pad(state, 9)} diff ${p.diffHash.slice(0, 12)}  pages: ${p.affectedPages.join(", ")}`;
}

export function formatProposal(p: Proposal, state: string): string {
  return [
    `${p.id}  ${p.action}  for ${p.contradictionId} (${p.severity})  state: ${state}`,
    `Rationale:       ${p.rationale}`,
    `Expected result: ${p.expectedResult}`,
    `Risk warning:    ${p.riskWarning}`,
    `Human approval:  required${p.highSeverityConfirmationRequired ? " + explicit HIGH severity confirmation (--confirm-high-severity)" : ""}`,
    `Affected pages:  ${p.affectedPages.join(", ")}   claims: ${p.affectedClaimIds.join(", ")}`,
    `Diff hash:       ${p.diffHash.slice(0, 12)}  (quote at least these 12 characters to approve this exact diff)`,
    "",
    ...p.changes.map((ch) => ch.diff.trimEnd()),
  ].join("\n");
}

export function formatDelta(delta: LintDelta, report: LintReport): string {
  const list = (xs: string[]) => (xs.length === 0 ? "none" : xs.join(", "));
  const errors = report.structural.filter((f) => f.level === "error").length;
  return [
    `Resolved since last lint:   ${list(delta.resolved)}`,
    `Newly under review:         ${list(delta.newlyUnderReview)}`,
    `Introduced since last lint: ${list(delta.introduced)}`,
    `New structural errors:      ${delta.structuralErrorsIntroduced.length} (total errors now ${errors})`,
    `Remaining contradictions:   ${report.contradictions.length} (${severityCounts(report.contradictions)})`,
    `Regression verdict:         ${delta.ok ? "PASS (nothing new introduced)" : "FAIL"}`,
  ].join("\n");
}

export function formatAuditTable(events: AuditEvent[]): string {
  const rows = events.map(
    (e) =>
      `  ${pad(String(e.seq), 3)} ${pad(e.timestamp.slice(11, 19), 9)}${pad(e.operation, 17)} ${pad(e.result, 8)} ${pad(e.actor, 16)} ${pad(e.proposalId ?? "-", 13)} ${e.reason.length > 70 ? `${e.reason.slice(0, 67)}...` : e.reason}`,
  );
  return [
    `  ${pad("#", 3)} ${pad("time", 9)}${pad("operation", 17)} ${pad("result", 8)} ${pad("actor", 16)} ${pad("proposal", 13)} reason`,
    ...rows,
  ].join("\n");
}
