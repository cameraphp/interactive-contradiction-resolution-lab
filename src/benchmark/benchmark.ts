import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Severity } from "../domain/predicates.js";
import { ProposalSchema, type ContradictionType } from "../domain/schemas.js";
import { loadKnowledgeBase, defaultKbPaths } from "../kb/knowledge-base.js";
import { computeManifest } from "../kb/sources.js";
import { lint } from "../lint/lint.js";
import { loadAdvisorFixtures, FixtureAdvisor, runAdvisor } from "../llm/advisor.js";
import { fixedClock } from "../util/clock.js";
import { hashOf, sha256 } from "../util/hash.js";
import { verifyAuditLog } from "../workflow/audit.js";
import {
  apply,
  approve,
  initLabWorkspace,
  propose,
  reject,
  relint,
  runLint,
  type WorkflowContext,
} from "../workflow/engine.js";

interface Expected {
  contradictions: Array<{
    claimIds: [string, string];
    type: ContradictionType;
    severity: Severity;
    sourceIds: string[];
  }>;
  compatiblePairs: Array<{ claimIds: [string, string]; why: string }>;
  injectionSources: string[];
}

export interface BenchmarkResult {
  dataset: { sources: number; claims: number; labelledContradictions: number; compatiblePairs: number };
  detection: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    compatibleNotFlagged: number;
    typeCorrect: number;
    severityCorrect: number;
    sourceRefsCorrect: number;
  };
  proposals: {
    total: number;
    schemaValid: number;
    appliedExactly: number;
    outcomeAsDeclared: number;
    runsWithIntroducedContradictions: number;
    highSeverity: number;
    highRequiringConfirmation: number;
  };
  gates: Record<
    | "unapprovedApplyBlocked"
    | "highWithoutConfirmationBlocked"
    | "rejectedNotApplied"
    | "staleApprovalRejected"
    | "staleApplyRejected"
    | "tamperedProposalRejected"
    | "wrongDiffHashRejected",
    boolean
  >;
  audit: { chainsVerified: number; chainsChecked: number; tamperDetected: boolean };
  injection: {
    instructionLinesFlagged: number;
    claimsFromInstructionLines: number;
    writesWithoutHumanApproval: number;
    advisorInjectionRejected: boolean;
  };
  sourcesUnchanged: boolean;
  repeatability: { runs: number; identical: boolean; fingerprint: string };
}

const pairKey = (ids: string[]) => [...ids].sort().join("+");

class Lab {
  private readonly dirs: string[] = [];
  constructor(private readonly repoRoot: string) {}
  fresh(): WorkflowContext {
    const dir = mkdtempSync(join(tmpdir(), "icrl-bench-"));
    this.dirs.push(dir);
    const kb = defaultKbPaths(this.repoRoot);
    return initLabWorkspace(
      join(dir, "ws"),
      { seedWikiDir: kb.wikiDir, sourcesDir: kb.sourcesDir, manifestPath: kb.manifestPath },
      fixedClock(),
      "benchmark",
    );
  }
  cleanup(): void {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
  }
}

function page(ctx: WorkflowContext, id: string): string {
  return readFileSync(join(ctx.ws.wikiDir, `${id}.md`), "utf8");
}

async function runOnce(repoRoot: string): Promise<Omit<BenchmarkResult, "repeatability">> {
  const expected = JSON.parse(
    readFileSync(join(repoRoot, "fixtures", "benchmark", "expected.json"), "utf8"),
  ) as Expected;
  const paths = defaultKbPaths(repoRoot);
  const manifestBefore = computeManifest(paths.sourcesDir);
  const lab = new Lab(repoRoot);
  const auditPaths: string[] = [];
  const track = (ctx: WorkflowContext) => (auditPaths.push(ctx.ws.auditPath), ctx);

  try {
    // Detection versus labels.
    const kb = loadKnowledgeBase(paths);
    const report = lint(kb);
    const detected = new Map(report.contradictions.map((c) => [pairKey(c.claimIds), c]));
    const labelled = new Map(expected.contradictions.map((e) => [pairKey(e.claimIds), e]));
    const tp = [...labelled.keys()].filter((k) => detected.has(k));
    const fp = [...detected.keys()].filter((k) => !labelled.has(k));
    const fn = [...labelled.keys()].filter((k) => !detected.has(k));
    let typeCorrect = 0;
    let severityCorrect = 0;
    let sourceRefsCorrect = 0;
    for (const key of tp) {
      const d = detected.get(key)!;
      const e = labelled.get(key)!;
      if (d.type === e.type) typeCorrect++;
      if (d.severity === e.severity) severityCorrect++;
      const refsOk =
        pairKey(d.sourceRefs.map((r) => r.sourceId)) === pairKey(e.sourceIds) &&
        d.sourceRefs.every((r) => {
          const claim = kb.claims.find((c) => c.id === r.claimId)!;
          return kb.sources.get(r.sourceId)?.lines[r.line - 1]?.includes(claim.originalText) === true;
        });
      if (refsOk) sourceRefsCorrect++;
    }
    const compatibleNotFlagged = expected.compatiblePairs.filter(
      (p) => !detected.has(pairKey(p.claimIds)),
    ).length;

    // Every proposal, each applied through the approval path in its own fresh workspace.
    const seed = track(lab.fresh());
    let total = 0;
    let schemaValid = 0;
    let appliedExactly = 0;
    let outcomeAsDeclared = 0;
    let introducedRuns = 0;
    let highSeverity = 0;
    let highRequiringConfirmation = 0;
    for (const c of runLint(seed).contradictions) {
      for (const p of propose(seed, c.id).proposals) {
        total++;
        if (ProposalSchema.safeParse(p).success) schemaValid++;
        if (p.severity === "HIGH") {
          highSeverity++;
          if (p.highSeverityConfirmationRequired) highRequiringConfirmation++;
        }
        const ctx = track(lab.fresh());
        propose(ctx, c.id);
        approve(ctx, p.id, { diffHash: p.diffHash, reason: "benchmark approval", confirmHighSeverity: true });
        const result = apply(ctx, p.id);
        if (result.ok && p.changes.every((ch) => sha256(page(ctx, ch.page)) === ch.newHash)) appliedExactly++;
        const { report: after, delta } = relint(ctx);
        if (!delta.ok) introducedRuns++;
        const still = after.contradictions.find((x) => x.id === c.id);
        const asDeclared =
          (p.expectedOutcome === "resolves" && !still) ||
          (p.expectedOutcome === "under-review" && still?.state === "under-review") ||
          (p.expectedOutcome === "follow-up-recorded" && still?.state === "open");
        if (asDeclared) outcomeAsDeclared++;
      }
    }

    // Gates.
    const g = track(lab.fresh());
    const gReport = runLint(g);
    const ctrOf = (claimId: string) => gReport.contradictions.find((c) => c.claimIds.includes(claimId))!.id;
    const acme = propose(g, ctrOf("CLM-ACME-001")).proposals;
    const mira = propose(g, ctrOf("CLM-MIRA-001")).proposals.find((p) => p.action === "keep-newer")!;
    const keepNewer = acme.find((p) => p.action === "keep-newer")!;
    const keepOlder = acme.find((p) => p.action === "keep-older")!;
    const acmeBefore = page(g, "acme-project");
    const unapprovedApplyBlocked = apply(g, keepNewer.id).code === "approval-required";
    const wrongDiffHashRejected =
      approve(g, keepNewer.id, { diffHash: "0".repeat(12), reason: "x" }).code === "diff-hash-mismatch";
    const highWithoutConfirmationBlocked =
      approve(g, mira.id, { diffHash: mira.diffHash, reason: "x" }).code ===
        "high-severity-confirmation-required" && apply(g, mira.id).code === "approval-required";
    reject(g, keepOlder.id, { reason: "benchmark rejection" });
    const rejectedNotApplied =
      apply(g, keepOlder.id).code === "proposal-rejected" && page(g, "acme-project") === acmeBefore;
    const writesWithoutHumanApproval = verifyAuditLog(g.ws.auditPath).events.filter(
      (e) => e.operation === "proposal.apply" && e.result === "success",
    ).length;

    const s1 = track(lab.fresh());
    const s1p = propose(s1, ctrOf("CLM-ACME-001")).proposals.find((p) => p.action === "keep-newer")!;
    const s1page = join(s1.ws.wikiDir, "acme-project.md");
    writeFileSync(s1page, readFileSync(s1page, "utf8").replace("confidence: 0.70", "confidence: 0.71"));
    const staleApprovalRejected =
      approve(s1, s1p.id, { diffHash: s1p.diffHash, reason: "x" }).code === "stale-proposal";

    const s2 = track(lab.fresh());
    const s2p = propose(s2, ctrOf("CLM-ACME-001")).proposals.find((p) => p.action === "keep-newer")!;
    approve(s2, s2p.id, { diffHash: s2p.diffHash, reason: "x" });
    const s2page = join(s2.ws.wikiDir, "acme-project.md");
    writeFileSync(s2page, readFileSync(s2page, "utf8").replace("confidence: 0.90", "confidence: 0.91"));
    const staleApplyRejected = apply(s2, s2p.id).code === "stale-proposal";

    const t = track(lab.fresh());
    const tp1 = propose(t, ctrOf("CLM-ATLAS-002")).proposals[0]!;
    const tPath = join(t.ws.proposalsDir, `${tp1.id}.json`);
    writeFileSync(tPath, JSON.stringify({ ...tp1, rationale: "edited after creation" }));
    const tamperedProposalRejected =
      approve(t, tp1.id, { diffHash: tp1.diffHash, reason: "x" }).code === "proposal-tampered";

    // Audit chains: all valid; a modified copy must fail.
    const chainsVerified = auditPaths.filter((p) => verifyAuditLog(p).ok).length;
    const tamperPath = auditPaths[auditPaths.length - 1]!;
    const original = readFileSync(tamperPath, "utf8");
    writeFileSync(tamperPath, original.replace('"actor":"benchmark"', '"actor":"someone-else"'));
    const tamperDetected = !verifyAuditLog(tamperPath).ok;
    writeFileSync(tamperPath, original);

    // Prompt injection.
    const flagged = kb.findings.filter(
      (f) =>
        f.code === "instruction-like-source-text" && expected.injectionSources.includes(f.sourceId ?? ""),
    );
    const flaggedLines = new Set(flagged.map((f) => `${f.sourceId}:${/line (\d+)/.exec(f.message)![1]}`));
    const claimsFromInstructionLines = kb.claims.filter((c) =>
      flaggedLines.has(`${c.sourceId}:${c.sourceLocation.line}`),
    ).length;
    const fixtures = loadAdvisorFixtures(join(repoRoot, "fixtures", "llm", "advisor-responses.json"));
    const target = report.contradictions[0]!;
    const advice = await runAdvisor(
      new FixtureAdvisor(fixtures["injection-obeying"]!, target, "injection-obeying"),
      kb,
      target,
    );

    const sourcesUnchanged = hashOf(computeManifest(paths.sourcesDir)) === hashOf(manifestBefore);
    return {
      dataset: {
        sources: kb.sources.size,
        claims: kb.claims.length,
        labelledContradictions: labelled.size,
        compatiblePairs: expected.compatiblePairs.length,
      },
      detection: {
        truePositives: tp.length,
        falsePositives: fp.length,
        falseNegatives: fn.length,
        precision: detected.size === 0 ? 0 : tp.length / detected.size,
        recall: labelled.size === 0 ? 0 : tp.length / labelled.size,
        compatibleNotFlagged,
        typeCorrect,
        severityCorrect,
        sourceRefsCorrect,
      },
      proposals: {
        total,
        schemaValid,
        appliedExactly,
        outcomeAsDeclared,
        runsWithIntroducedContradictions: introducedRuns,
        highSeverity,
        highRequiringConfirmation,
      },
      gates: {
        unapprovedApplyBlocked,
        highWithoutConfirmationBlocked,
        rejectedNotApplied,
        staleApprovalRejected,
        staleApplyRejected,
        tamperedProposalRejected,
        wrongDiffHashRejected,
      },
      audit: { chainsVerified, chainsChecked: auditPaths.length, tamperDetected },
      injection: {
        instructionLinesFlagged: flagged.length,
        claimsFromInstructionLines,
        writesWithoutHumanApproval,
        advisorInjectionRejected: advice.status === "rejected",
      },
      sourcesUnchanged,
    };
  } finally {
    lab.cleanup();
  }
}

export async function runBenchmark(repoRoot: string, runs = 3): Promise<BenchmarkResult> {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await runOnce(repoRoot));
  const fingerprints = results.map((r) => hashOf(r));
  return {
    ...results[0]!,
    repeatability: {
      runs,
      identical: new Set(fingerprints).size === 1,
      fingerprint: fingerprints[0]!.slice(0, 16),
    },
  };
}

/** True when every measured property meets its target. Used by tests and the benchmark CLI exit code. */
export function benchmarkPassed(r: BenchmarkResult): boolean {
  return (
    r.detection.falseNegatives === 0 &&
    r.detection.falsePositives === 0 &&
    r.detection.compatibleNotFlagged === r.dataset.compatiblePairs &&
    r.detection.typeCorrect === r.detection.truePositives &&
    r.detection.severityCorrect === r.detection.truePositives &&
    r.detection.sourceRefsCorrect === r.detection.truePositives &&
    r.proposals.schemaValid === r.proposals.total &&
    r.proposals.appliedExactly === r.proposals.total &&
    r.proposals.outcomeAsDeclared === r.proposals.total &&
    r.proposals.runsWithIntroducedContradictions === 0 &&
    r.proposals.highRequiringConfirmation === r.proposals.highSeverity &&
    Object.values(r.gates).every(Boolean) &&
    r.audit.chainsVerified === r.audit.chainsChecked &&
    r.audit.tamperDetected &&
    r.injection.claimsFromInstructionLines === 0 &&
    r.injection.writesWithoutHumanApproval === 0 &&
    r.injection.advisorInjectionRejected &&
    r.sourcesUnchanged &&
    r.repeatability.identical
  );
}

const yes = (b: boolean) => (b ? "yes" : "**NO**");
const frac = (a: number, b: number) => `${a}/${b}`;

export function formatBenchmarkMarkdown(r: BenchmarkResult): string {
  const d = r.detection;
  const p = r.proposals;
  return [
    "# Benchmark summary",
    "",
    "> Generated by `npm test` (tests/benchmark.test.ts) and `npm run benchmark`. Deterministic: no timestamps or",
    "> machine paths. **Synthetic and small**: the numbers describe this fixture only and are not a general",
    "> measure of detection quality.",
    "",
    `Dataset: ${r.dataset.sources} synthetic sources, ${r.dataset.claims} claims, ${r.dataset.labelledContradictions} hand-labelled contradictions, ${r.dataset.compatiblePairs} hand-labelled compatible pairs.`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| True contradictions detected | ${frac(d.truePositives, r.dataset.labelledContradictions)} |`,
    `| False positives / false negatives | ${d.falsePositives} / ${d.falseNegatives} |`,
    `| Precision / recall on this fixture | ${d.precision.toFixed(2)} / ${d.recall.toFixed(2)} |`,
    `| Compatible pairs not flagged | ${frac(d.compatibleNotFlagged, r.dataset.compatiblePairs)} |`,
    `| Contradiction type correct | ${frac(d.typeCorrect, d.truePositives)} |`,
    `| Severity classification correct | ${frac(d.severityCorrect, d.truePositives)} |`,
    `| Source references correct (id, line, quoted text) | ${frac(d.sourceRefsCorrect, d.truePositives)} |`,
    `| Proposals schema-valid | ${frac(p.schemaValid, p.total)} |`,
    `| Approved proposals applied exactly (page hash = proposal new hash) | ${frac(p.appliedExactly, p.total)} |`,
    `| Proposals whose declared outcome held after regression lint | ${frac(p.outcomeAsDeclared, p.total)} |`,
    `| Resolutions that introduced a new contradiction or structural error | ${p.runsWithIntroducedContradictions} |`,
    `| HIGH proposals requiring explicit confirmation | ${frac(p.highRequiringConfirmation, p.highSeverity)} |`,
    `| Apply without approval blocked | ${yes(r.gates.unapprovedApplyBlocked)} |`,
    `| HIGH approval without confirmation blocked | ${yes(r.gates.highWithoutConfirmationBlocked)} |`,
    `| Approval quoting the wrong diff hash rejected | ${yes(r.gates.wrongDiffHashRejected)} |`,
    `| Rejected proposal not applied | ${yes(r.gates.rejectedNotApplied)} |`,
    `| Stale approval rejected (claim changed before approval) | ${yes(r.gates.staleApprovalRejected)} |`,
    `| Stale apply rejected (page changed after approval) | ${yes(r.gates.staleApplyRejected)} |`,
    `| Proposal edited after creation rejected | ${yes(r.gates.tamperedProposalRejected)} |`,
    `| Audit chains verified | ${frac(r.audit.chainsVerified, r.audit.chainsChecked)} |`,
    `| Audit tampering detected | ${yes(r.audit.tamperDetected)} |`,
    `| Instruction-like source lines flagged (informational) | ${r.injection.instructionLinesFlagged} |`,
    `| Claims extracted from instruction-like lines | ${r.injection.claimsFromInstructionLines} |`,
    `| Wiki writes without human approval | ${r.injection.writesWithoutHumanApproval} |`,
    `| Injection-obeying advisor response rejected | ${yes(r.injection.advisorInjectionRejected)} |`,
    `| Raw sources unchanged after the run | ${yes(r.sourcesUnchanged)} |`,
    `| Repeatability (${r.repeatability.runs} full runs, identical results) | ${yes(r.repeatability.identical)} (fingerprint ${r.repeatability.fingerprint}) |`,
    "",
    `Overall: ${benchmarkPassed(r) ? "all targets met" : "**TARGETS NOT MET**"}.`,
    "",
  ].join("\n");
}

export function writeBenchmarkReport(r: BenchmarkResult, dir: string): void {
  writeFileSync(join(dir, "benchmark-summary.md"), formatBenchmarkMarkdown(r));
  writeFileSync(join(dir, "benchmark-summary.json"), `${JSON.stringify(r, null, 2)}\n`);
}
