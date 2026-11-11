import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultKbPaths } from "../kb/knowledge-base.js";
import { computeManifest } from "../kb/sources.js";
import {
  formatAuditTable,
  formatContradictionDetail,
  formatDelta,
  formatFindingsBySeverity,
  formatProposal,
  severityCounts,
} from "../report/format.js";
import { fixedClock } from "../util/clock.js";
import { hashOf } from "../util/hash.js";
import { verifyAuditLog } from "../workflow/audit.js";
import {
  apply,
  approve,
  initLabWorkspace,
  loadWorkspaceKb,
  propose,
  proposalState,
  relint,
  runLint,
  type OpResult,
} from "../workflow/engine.js";

export interface DemoIo {
  out(text: string): void;
}

const DEMO_START = "2026-11-11T10:00:00.000Z";

/**
 * End-to-end deterministic walkthrough. It uses the same engine functions as the CLI; the only scripted part
 * is the reviewer's approval in step 6, which stands in for a person running `approve` by hand.
 * Returns 0 only if every expected outcome happened.
 */
export function runDemo(repoRoot: string, io: DemoIo, opts: { workspaceRoot?: string } = {}): number {
  const say = (s = "") => io.out(s);
  const step = (n: number, title: string) => say(`\n[${n}/9] ${title}`);
  const problems: string[] = [];
  const expect = (cond: boolean, what: string) => {
    if (!cond) problems.push(what);
  };
  const outcome = (label: string, r: OpResult) =>
    say(`  ${label} -> ${r.ok ? "OK" : "BLOCKED"} [${r.code}]${r.ok ? "" : ` ${r.message}`}`);

  const kbPaths = defaultKbPaths(repoRoot);
  const manifestBefore = hashOf(computeManifest(kbPaths.sourcesDir));
  const wsRoot = opts.workspaceRoot ?? join(repoRoot, ".lab", "demo-workspace");

  say("Interactive Contradiction Resolution Lab - deterministic demonstration");
  say(
    "All data is synthetic and fictional. No API key, no network, no model. Clock fixed at " +
      DEMO_START +
      ".",
  );

  step(1, "Load immutable sources");
  const ctx = initLabWorkspace(
    wsRoot,
    {
      seedWikiDir: kbPaths.wikiDir,
      sourcesDir: kbPaths.sourcesDir,
      manifestPath: kbPaths.manifestPath,
      force: true,
    },
    fixedClock(DEMO_START),
    "demo-operator",
  );
  const kb = loadWorkspaceKb(ctx.ws);
  const flagged = kb.findings.filter((f) => f.code === "instruction-like-source-text");
  say(`  ${kb.sources.size} synthetic sources; sha256 manifest verified (fixtures/kb/sources.manifest.json)`);
  say(
    `  ${flagged.length} instruction-like lines flagged in ${[...new Set(flagged.map((f) => f.sourceId))].join(", ")}; treated as inert data:`,
  );
  say(`    "${kb.sources.get("SRC-010")!.lines[18]}"`);
  const fromInjection = kb.claims.filter(
    (c) => c.sourceId === "SRC-010" && c.sourceLocation.line >= 19,
  ).length;
  say(`  claims extracted from those lines: ${fromInjection}; operations they can trigger: none`);
  expect(fromInjection === 0, "no claims from injection lines");

  step(2, "Build the claim index");
  const errors = kb.findings.filter((f) => f.level === "error");
  say(`  ${kb.claims.length} typed claims across ${kb.pages.size - 2} wiki pages (plus index.md and log.md)`);
  say(
    `  citations verified (source id + line + quoted text): ${kb.claims.length - errors.length}/${kb.claims.length}`,
  );
  say("  working copy: .lab/demo-workspace/wiki (sources are referenced read-only, never copied or written)");
  expect(errors.length === 0, "no structural errors");

  step(3, "Detect contradictions (deterministic rules, no LLM)");
  const report = runLint(ctx);
  say(`  ${report.contradictions.length} contradictions - ${severityCounts(report.contradictions)}`);
  say(
    "  not flagged (compatible): Ledger uses PostgreSQL for transactions AND Redis for caching (multi-valued),",
  );
  say(
    "  Borealis 'May 2026' vs '19 May 2026' (refinement), Mira 'not on-call' vs 'not approved' (different predicates)",
  );
  expect(report.contradictions.length === 6, "six contradictions");

  step(4, "Findings grouped by severity");
  say(formatFindingsBySeverity(report.contradictions));

  const harbor = report.contradictions.find((c) => c.claimIds.includes("CLM-HARBOR-001"))!;
  const mira = report.contradictions.find((c) => c.claimIds.includes("CLM-MIRA-001"))!;

  step(
    5,
    `Resolution proposals for ${harbor.id} (${harbor.severity} ${harbor.type}: Harbor daily throughput)`,
  );
  const harborProposals = propose(ctx, harbor.id).proposals;
  say(`  ${harborProposals.length} proposals: ${harborProposals.map((p) => p.action).join(", ")}`);
  const chosen = harborProposals.find((p) => p.action === harbor.recommendedAction)!;
  say(`  recommended action: ${harbor.recommendedAction}\n`);
  say(formatProposal(chosen, proposalState(ctx.ws, chosen.id)).replace(/^/gm, "  "));

  step(6, `Explicit approval path (${harbor.severity}): approve exactly this diff, then apply`);
  say("  (In the CLI these are separate commands typed by a reviewer; here they are scripted.)");
  const approved = approve(ctx, chosen.id, {
    diffHash: chosen.diffHash.slice(0, 12),
    reason: "Throughput grew between the Q1 report and the capacity review; both values are time-scoped.",
  });
  outcome(`approve ${chosen.id} --diff-hash ${chosen.diffHash.slice(0, 12)} --reason "..."`, approved);
  const applied = apply(ctx, chosen.id);
  outcome(`apply ${chosen.id}`, applied);
  expect(approved.ok && applied.ok, "MEDIUM resolution applied");

  step(7, `HIGH severity stays blocked without explicit approval: ${mira.id}`);
  say(formatContradictionDetail(mira, kb).replace(/^/gm, "  "));
  const miraProposals = propose(ctx, mira.id).proposals;
  const risky = miraProposals.find((p) => p.action === "keep-newer")!;
  const pageBefore = readFileSync(join(ctx.ws.wikiDir, "reviewer-access.md"), "utf8");
  say("");
  const noApproval = apply(ctx, risky.id);
  outcome(`apply ${risky.id} (keep-newer, no approval)`, noApproval);
  const noConfirm = approve(ctx, risky.id, { diffHash: risky.diffHash.slice(0, 12), reason: "looks right" });
  outcome(`approve ${risky.id} without --confirm-high-severity`, noConfirm);
  const unchanged = readFileSync(join(ctx.ws.wikiDir, "reviewer-access.md"), "utf8") === pageBefore;
  say(
    `  reviewer-access.md unchanged: ${unchanged ? "yes" : "NO"}; left open for someone with authority over reviewer access`,
  );
  expect(
    noApproval.code === "approval-required" &&
      noConfirm.code === "high-severity-confirmation-required" &&
      unchanged,
    "HIGH resolution blocked",
  );

  step(8, "Regression lint");
  const { report: after, delta } = relint(ctx);
  say(formatDelta(delta, after).replace(/^/gm, "  "));
  expect(delta.ok && delta.resolved.length === 1 && delta.resolved[0] === harbor.id, "regression lint");

  step(9, "Audit log (append-only, hash-chained)");
  const audit = verifyAuditLog(ctx.ws.auditPath);
  say(formatAuditTable(audit.events));
  say(
    `  chain: ${audit.ok ? "VALID" : "BROKEN"}, ${audit.events.length} events, head ${audit.headHash.slice(0, 16)}`,
  );
  const sourcesUnchanged = hashOf(computeManifest(kbPaths.sourcesDir)) === manifestBefore;
  say(`  raw sources unchanged after demo: ${sourcesUnchanged ? "yes" : "NO"}`);
  expect(audit.ok && sourcesUnchanged, "audit chain valid and sources unchanged");

  say("");
  if (problems.length > 0) {
    say(`DEMO FAILED: ${problems.join("; ")}`);
    return 1;
  }
  say(
    "Demo complete: every expected outcome occurred. Inspect .lab/demo-workspace or continue with `npm run lab`.",
  );
  return 0;
}
