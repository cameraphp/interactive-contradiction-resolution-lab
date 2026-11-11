import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../config.js";
import { defaultKbPaths, SourceIntegrityError } from "../kb/knowledge-base.js";
import { verifyManifest } from "../kb/sources.js";
import { advisorFromSetting, loadAdvisorFixtures, runAdvisor } from "../llm/advisor.js";
import {
  formatAuditTable,
  formatContradictionDetail,
  formatDelta,
  formatFindingsBySeverity,
  formatLintReport,
  formatProposal,
  formatProposalSummary,
} from "../report/format.js";
import { systemClock, type Clock } from "../util/clock.js";
import { toPosix } from "../util/fs.js";
import { AuditTamperError, verifyAuditLog } from "../workflow/audit.js";
import {
  apply,
  approve,
  findContradiction,
  initLabWorkspace,
  listProposals,
  loadWorkspaceKb,
  propose,
  proposalState,
  readProposal,
  reject,
  relint,
  runLint,
  type OpResult,
  type WorkflowContext,
} from "../workflow/engine.js";
import { openWorkspace } from "../workflow/workspace.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliOptions {
  clock?: Clock;
  env?: Record<string, string | undefined>;
  repoRoot?: string;
}

const USAGE = `Usage: npm run lab -- <command> [args] [--workspace DIR] [--actor NAME]

Workspace
  init [--force]                         copy the seed wiki into a fresh workspace (default .lab/workspace)
  manifest                               verify raw sources against the pinned sha256 manifest

Detection (read-only)
  lint                                   detect contradictions + structural findings; saves the lint baseline
  contradictions [--severity LEVEL]      list contradictions grouped by severity
  show <CTR-id> [--advisor SETTING]      evidence, explanation, severity rules (advisor: disabled | fixture:<name>)

Resolution (human approval required)
  propose <CTR-id>                       generate resolution proposals (records them in the audit log)
  proposals                              list proposals and their audit-derived state
  proposal <PRP-id>                      show one proposal with its exact diff and diff hash
  approve <PRP-id> --diff-hash HASH --reason TEXT [--confirm-high-severity]
  reject <PRP-id> --reason TEXT
  apply <PRP-id>                         apply an approved proposal's exact diff

Verification
  relint                                 regression lint against the last baseline (exit 1 if anything new)
  audit-log [--verify]                   show the hash-chained audit log (exit 1 if the chain is broken)

Exit codes: 0 ok, 1 blocked / failed / regression, 2 usage or integrity error.`;

export async function runCli(argv: string[], io: CliIo, opts: CliOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        workspace: { type: "string" },
        actor: { type: "string" },
        force: { type: "boolean" },
        severity: { type: "string" },
        advisor: { type: "string" },
        "diff-hash": { type: "string" },
        reason: { type: "string" },
        "confirm-high-severity": { type: "boolean" },
        verify: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    io.err(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, target] = positionals;
  if (!command || values.help) {
    io.out(USAGE);
    return command ? 0 : 2;
  }

  const kbPaths = defaultKbPaths(repoRoot);
  const wsRoot = values.workspace ?? join(repoRoot, ".lab", "workspace");
  const actor = values.actor ?? env.LAB_ACTOR ?? "local-operator";
  const clock = opts.clock ?? systemClock;
  const rel = (p: string) => toPosix(relative(repoRoot, p)) || ".";
  const ctx = (): WorkflowContext => ({ ws: openWorkspace(wsRoot), clock, actor: actor || "local-operator" });
  const need = (what: string): string => {
    if (!target) throw new UsageError(`${command} requires ${what}`);
    return target;
  };
  const report = (r: OpResult): number => {
    (r.ok ? io.out : io.err)(`${r.ok ? "OK" : "BLOCKED"} [${r.code}] ${r.message}`);
    if (r.event)
      io.out(
        `audit #${r.event.seq} ${r.event.operation} ${r.event.result} (hash ${r.event.hash.slice(0, 12)})`,
      );
    return r.ok ? 0 : 1;
  };

  try {
    switch (command) {
      case "init": {
        const c = initLabWorkspace(
          wsRoot,
          {
            seedWikiDir: kbPaths.wikiDir,
            sourcesDir: kbPaths.sourcesDir,
            manifestPath: kbPaths.manifestPath,
            force: values.force === true,
          },
          clock,
          actor,
        );
        io.out(
          `Workspace ready at ${rel(c.ws.root)} (wiki copied from ${rel(kbPaths.wikiDir)}; sources stay read-only in ${rel(kbPaths.sourcesDir)})`,
        );
        return 0;
      }
      case "manifest": {
        const check = verifyManifest(kbPaths.sourcesDir, kbPaths.manifestPath);
        io.out(
          check.ok
            ? "Source manifest: OK (all sources match their pinned sha256)"
            : `Source manifest: FAILED\n  ${check.problems.join("\n  ")}`,
        );
        return check.ok ? 0 : 2;
      }
      case "lint": {
        io.out(formatLintReport(runLint(ctx())));
        return 0;
      }
      case "contradictions": {
        const level = values.severity?.toUpperCase();
        if (level && !["HIGH", "MEDIUM", "LOW"].includes(level))
          throw new UsageError("--severity must be HIGH, MEDIUM or LOW");
        const all = runLint(ctx()).contradictions.filter((c) => !level || c.severity === level);
        io.out(all.length === 0 ? "No contradictions." : formatFindingsBySeverity(all, ""));
        return 0;
      }
      case "show": {
        const c = ctx();
        const kb = loadWorkspaceKb(c.ws);
        const id = need("a contradiction id");
        const found = findContradiction(runLint(c), id);
        if (!found) {
          io.err(`No current contradiction ${id}. Run "lint" to list them.`);
          return 1;
        }
        const fixtures = loadAdvisorFixtures(join(repoRoot, "fixtures", "llm", "advisor-responses.json"));
        const advisor = advisorFromSetting(values.advisor ?? env.LAB_LLM_ADVISOR, fixtures, found);
        io.out(formatContradictionDetail(found, kb, await runAdvisor(advisor, kb, found)));
        return 0;
      }
      case "propose": {
        const c = ctx();
        const result = propose(c, need("a contradiction id"));
        if (!result.ok) {
          io.err(result.message);
          return 1;
        }
        io.out(
          `${result.proposals.length} proposals for ${target} (${result.created.length} newly recorded):`,
        );
        for (const p of result.proposals) io.out(`  ${formatProposalSummary(p, proposalState(c.ws, p.id))}`);
        io.out(`\nInspect one with: npm run lab -- proposal <PRP-id>`);
        return 0;
      }
      case "proposals": {
        const c = ctx();
        const all = listProposals(c.ws);
        io.out(
          all.length === 0
            ? "No proposals yet."
            : all.map((p) => formatProposalSummary(p, proposalState(c.ws, p.id))).join("\n"),
        );
        return 0;
      }
      case "proposal": {
        const c = ctx();
        const p = readProposal(c.ws, need("a proposal id"));
        if (!p) {
          io.err(`No proposal ${target}.`);
          return 1;
        }
        io.out(formatProposal(p, proposalState(c.ws, p.id)));
        return 0;
      }
      case "approve":
        return report(
          approve(ctx(), need("a proposal id"), {
            diffHash: values["diff-hash"] ?? "",
            reason: values.reason ?? "",
            confirmHighSeverity: values["confirm-high-severity"] === true,
          }),
        );
      case "reject":
        return report(reject(ctx(), need("a proposal id"), { reason: values.reason ?? "" }));
      case "apply":
        return report(apply(ctx(), need("a proposal id")));
      case "relint": {
        const { report: r, delta, event } = relint(ctx());
        io.out(formatDelta(delta, r));
        io.out(`audit #${event.seq} lint.relint ${event.result}`);
        return delta.ok ? 0 : 1;
      }
      case "audit-log": {
        const v = verifyAuditLog(ctx().ws.auditPath);
        if (!values.verify) io.out(formatAuditTable(v.events));
        io.out(
          v.ok
            ? `Chain: VALID - ${v.events.length} events, head hash ${v.headHash.slice(0, 16)} (record it elsewhere to detect truncation)`
            : `Chain: BROKEN\n  ${v.problems.join("\n  ")}`,
        );
        return v.ok ? 0 : 1;
      }
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    if (err instanceof SourceIntegrityError || err instanceof AuditTamperError) {
      io.err(`INTEGRITY ERROR: ${err.message}`);
      return 2;
    }
    io.err(`Error: ${(err as Error).message}`);
    return 2;
  }
}

class UsageError extends Error {}
