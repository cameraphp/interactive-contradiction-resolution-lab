import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProposalSchema, type AuditEvent, type Contradiction, type Proposal } from "../domain/schemas.js";
import { loadKnowledgeBase, type KnowledgeBase } from "../kb/knowledge-base.js";
import { compareLint, lint, type LintDelta, type LintReport } from "../lint/lint.js";
import { claimFingerprint, generateProposals, proposalHash } from "../resolve/proposals.js";
import type { Clock } from "../util/clock.js";
import { unifiedDiff } from "../util/diff.js";
import { guardedWrite } from "../util/fs.js";
import { hashOf, sha256 } from "../util/hash.js";
import { appendAuditEvent, verifyAuditLog, type AuditEventInput } from "./audit.js";
import { initWorkspace, type InitOptions, type Workspace } from "./workspace.js";

export interface WorkflowContext {
  ws: Workspace;
  clock: Clock;
  /** A label recorded in the audit log. It is not authentication. */
  actor: string;
}

export interface OpResult {
  ok: boolean;
  code: string;
  message: string;
  event?: AuditEvent;
}

export type ProposalState = "unknown" | "proposed" | "approved" | "rejected" | "applied";

const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const MIN_DIFF_HASH_PREFIX = 12;

function assertActor(actor: string): void {
  if (!ACTOR_PATTERN.test(actor)) throw new Error(`invalid actor label "${actor}"`);
}

function write(ctx: WorkflowContext, path: string, content: string): void {
  guardedWrite(path, content, { workspaceRoot: ctx.ws.root, protectedDirs: ctx.ws.protectedDirs });
}

function audit(ctx: WorkflowContext, input: Omit<AuditEventInput, "actor">): AuditEvent {
  return appendAuditEvent(ctx.ws.auditPath, { actor: ctx.actor, ...input }, ctx.clock);
}

const EMPTY: Pick<
  AuditEventInput,
  | "contradictionId"
  | "proposalId"
  | "sourceClaimIds"
  | "oldContentHash"
  | "newContentHash"
  | "proposalHash"
  | "diffHash"
> = {
  contradictionId: null,
  proposalId: null,
  sourceClaimIds: [],
  oldContentHash: null,
  newContentHash: null,
  proposalHash: null,
  diffHash: null,
};

export function loadWorkspaceKb(ws: Workspace): KnowledgeBase {
  return loadKnowledgeBase(ws.kb);
}

function wikiStateHash(kb: KnowledgeBase): string {
  return hashOf(Object.fromEntries([...kb.pages.values()].map((p) => [p.id, sha256(p.content)])));
}

export function initLabWorkspace(
  root: string,
  opts: InitOptions,
  clock: Clock,
  actor: string,
): WorkflowContext {
  assertActor(actor);
  const ws = initWorkspace(root, opts);
  const ctx = { ws, clock, actor };
  const kb = loadWorkspaceKb(ws);
  const report = lint(kb);
  write(ctx, ws.baselinePath, `${JSON.stringify(report, null, 2)}\n`);
  audit(ctx, {
    ...EMPTY,
    operation: "workspace.init",
    newContentHash: wikiStateHash(kb),
    result: "success",
    reason: `workspace created from seed wiki; ${report.contradictions.length} contradictions at baseline`,
  });
  return ctx;
}

export function runLint(ctx: WorkflowContext): LintReport {
  const report = lint(loadWorkspaceKb(ctx.ws));
  write(ctx, ctx.ws.baselinePath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function readBaseline(ws: Workspace): LintReport {
  return JSON.parse(readFileSync(ws.baselinePath, "utf8")) as LintReport;
}

/** Regression lint: compare the current wiki with the last lint snapshot, record the verdict, move the baseline. */
export function relint(ctx: WorkflowContext): { report: LintReport; delta: LintDelta; event: AuditEvent } {
  const before = readBaseline(ctx.ws);
  const report = lint(loadWorkspaceKb(ctx.ws));
  const delta = compareLint(before, report);
  const event = audit(ctx, {
    ...EMPTY,
    operation: "lint.relint",
    result: delta.ok ? "success" : "failed",
    reason: `resolved=[${delta.resolved.join(",")}] introduced=[${delta.introduced.join(",")}] newly-under-review=[${delta.newlyUnderReview.join(",")}] new-structural-errors=${delta.structuralErrorsIntroduced.length}`,
  });
  write(ctx, ctx.ws.baselinePath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, delta, event };
}

export function findContradiction(report: LintReport, id: string): Contradiction | undefined {
  return report.contradictions.find((c) => c.id === id);
}

function proposalPath(ws: Workspace, id: string): string {
  if (!/^PRP-[0-9a-f]{8}$/.test(id)) throw new Error(`invalid proposal id "${id}"`);
  return join(ws.proposalsDir, `${id}.json`);
}

export function readProposal(ws: Workspace, id: string): Proposal | null {
  const path = proposalPath(ws, id);
  if (!existsSync(path)) return null;
  return ProposalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function listProposals(ws: Workspace): Proposal[] {
  if (!existsSync(ws.proposalsDir)) return [];
  return readdirSync(ws.proposalsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readProposal(ws, f.slice(0, -5))!)
    .filter(Boolean);
}

export function proposalEvents(ws: Workspace, id: string): AuditEvent[] {
  const verification = verifyAuditLog(ws.auditPath);
  return verification.events.filter((e) => e.proposalId === id && e.result === "success");
}

/** Proposal state is derived from the hash-chained audit log, never from a mutable status field. */
export function proposalState(ws: Workspace, id: string): ProposalState {
  const ops = new Set(proposalEvents(ws, id).map((e) => e.operation));
  if (ops.has("proposal.apply")) return "applied";
  if (ops.has("proposal.reject")) return "rejected";
  if (ops.has("proposal.approve")) return "approved";
  if (ops.has("proposal.create")) return "proposed";
  return "unknown";
}

export function propose(
  ctx: WorkflowContext,
  contradictionId: string,
): { ok: boolean; message: string; proposals: Proposal[]; created: string[] } {
  const kb = loadWorkspaceKb(ctx.ws);
  const contradiction = findContradiction(lint(kb), contradictionId);
  if (!contradiction) {
    return { ok: false, message: `no current contradiction ${contradictionId}`, proposals: [], created: [] };
  }
  const proposals = generateProposals(kb, contradiction);
  const created: string[] = [];
  for (const p of proposals) {
    const path = proposalPath(ctx.ws, p.id);
    const existing = readProposal(ctx.ws, p.id);
    if (existing) {
      if (proposalHash(existing) !== proposalHash(p)) {
        throw new Error(`proposal file ${p.id} exists with different content; refusing to overwrite`);
      }
      continue;
    }
    write(ctx, path, `${JSON.stringify(p, null, 2)}\n`);
    audit(ctx, {
      ...EMPTY,
      operation: "proposal.create",
      contradictionId: p.contradictionId,
      proposalId: p.id,
      sourceClaimIds: p.affectedClaimIds,
      proposalHash: proposalHash(p),
      diffHash: p.diffHash,
      result: "success",
      reason: `${p.action} (${p.severity})`,
    });
    created.push(p.id);
  }
  return { ok: true, message: `${proposals.length} proposals`, proposals, created };
}

/** Reasons the proposal no longer matches the knowledge base it was computed from. Empty = fresh. */
export function staleness(kb: KnowledgeBase, p: Proposal): string[] {
  const reasons: string[] = [];
  for (const [page, hash] of Object.entries(p.basis.pages)) {
    const current = kb.pages.get(page);
    if (!current) reasons.push(`page ${page} no longer exists`);
    else if (sha256(current.content) !== hash)
      reasons.push(`page ${page} changed after the proposal was created`);
  }
  for (const [id, fingerprint] of Object.entries(p.basis.claims)) {
    const current = kb.claims.find((c) => c.id === id);
    if (!current) reasons.push(`claim ${id} no longer exists or is invalid`);
    else if (claimFingerprint(current) !== fingerprint)
      reasons.push(`claim ${id} changed after the proposal was created`);
  }
  return reasons;
}

interface Loaded {
  proposal: Proposal;
  hash: string;
  state: ProposalState;
  events: AuditEvent[];
}

/** Load a proposal and check its file still matches the hash recorded when it was created. */
function load(ctx: WorkflowContext, id: string, op: AuditEventInput["operation"]): Loaded | OpResult {
  const block = (code: string, message: string, extra: Partial<AuditEventInput> = {}): OpResult => ({
    ok: false,
    code,
    message,
    event: audit(ctx, {
      ...EMPTY,
      operation: op,
      proposalId: id,
      result: "blocked",
      reason: `${code}: ${message}`,
      ...extra,
    }),
  });
  let proposal: Proposal | null;
  try {
    proposal = readProposal(ctx.ws, id);
  } catch {
    return block("proposal-invalid", "proposal file does not match the proposal schema");
  }
  if (!proposal) return block("proposal-unknown", `no proposal ${id}`);
  const hash = proposalHash(proposal);
  const events = proposalEvents(ctx.ws, id);
  const created = events.find((e) => e.operation === "proposal.create");
  const meta = {
    contradictionId: proposal.contradictionId,
    sourceClaimIds: proposal.affectedClaimIds,
    proposalHash: hash,
  };
  if (!created || created.proposalHash !== hash) {
    return block("proposal-tampered", "proposal file differs from the version recorded at creation", meta);
  }
  return { proposal, hash, state: proposalState(ctx.ws, id), events };
}

export interface ApproveOptions {
  /** The diff hash the reviewer was shown. Binds the approval to the exact diff. */
  diffHash: string;
  reason: string;
  confirmHighSeverity?: boolean;
}

export function approve(ctx: WorkflowContext, id: string, opts: ApproveOptions): OpResult {
  assertActor(ctx.actor);
  const loaded = load(ctx, id, "proposal.approve");
  if ("ok" in loaded) return loaded;
  const { proposal: p, hash, state } = loaded;
  const meta = {
    contradictionId: p.contradictionId,
    proposalId: p.id,
    sourceClaimIds: p.affectedClaimIds,
    proposalHash: hash,
    diffHash: p.diffHash,
  };
  const block = (code: string, message: string): OpResult => ({
    ok: false,
    code,
    message,
    event: audit(ctx, {
      ...EMPTY,
      ...meta,
      operation: "proposal.approve",
      result: "blocked",
      reason: `${code}: ${message}`,
    }),
  });

  if (state !== "proposed")
    return block(`already-${state}`, `proposal is ${state}; create a new proposal instead`);
  const given = opts.diffHash.trim().toLowerCase();
  if (given.length < MIN_DIFF_HASH_PREFIX || !p.diffHash.startsWith(given)) {
    return block(
      "diff-hash-mismatch",
      `approval must quote at least ${MIN_DIFF_HASH_PREFIX} characters of the displayed diff hash`,
    );
  }
  if (opts.reason.trim() === "") return block("reason-required", "an approval reason is required");
  if (p.highSeverityConfirmationRequired && opts.confirmHighSeverity !== true) {
    return block(
      "high-severity-confirmation-required",
      "HIGH severity proposals need an explicit high-severity confirmation in addition to approval",
    );
  }
  const stale = staleness(loadWorkspaceKb(ctx.ws), p);
  if (stale.length > 0) return block("stale-proposal", stale.join("; "));

  const event = audit(ctx, {
    ...EMPTY,
    ...meta,
    operation: "proposal.approve",
    result: "success",
    reason: opts.reason.trim(),
  });
  return { ok: true, code: "approved", message: `approved ${p.id} (diff ${p.diffHash.slice(0, 12)})`, event };
}

export function reject(ctx: WorkflowContext, id: string, opts: { reason: string }): OpResult {
  assertActor(ctx.actor);
  const loaded = load(ctx, id, "proposal.reject");
  if ("ok" in loaded) return loaded;
  const { proposal: p, hash, state } = loaded;
  const meta = {
    contradictionId: p.contradictionId,
    proposalId: p.id,
    sourceClaimIds: p.affectedClaimIds,
    proposalHash: hash,
    diffHash: p.diffHash,
  };
  if (state === "applied" || state === "rejected" || opts.reason.trim() === "") {
    const code = opts.reason.trim() === "" ? "reason-required" : `already-${state}`;
    return {
      ok: false,
      code,
      message: code === "reason-required" ? "a rejection reason is required" : `proposal is ${state}`,
      event: audit(ctx, { ...EMPTY, ...meta, operation: "proposal.reject", result: "blocked", reason: code }),
    };
  }
  const event = audit(ctx, {
    ...EMPTY,
    ...meta,
    operation: "proposal.reject",
    result: "success",
    reason: opts.reason.trim(),
  });
  return { ok: true, code: "rejected", message: `rejected ${p.id}; it can never be applied`, event };
}

export function apply(ctx: WorkflowContext, id: string): OpResult {
  assertActor(ctx.actor);
  const loaded = load(ctx, id, "proposal.apply");
  if ("ok" in loaded) return loaded;
  const { proposal: p, hash, state, events } = loaded;
  const oldContentHash = hashOf(Object.fromEntries(p.changes.map((c) => [c.page, c.oldHash])));
  const newContentHash = hashOf(Object.fromEntries(p.changes.map((c) => [c.page, c.newHash])));
  const meta = {
    contradictionId: p.contradictionId,
    proposalId: p.id,
    sourceClaimIds: p.affectedClaimIds,
    proposalHash: hash,
    diffHash: p.diffHash,
    oldContentHash,
    newContentHash,
  };
  const block = (code: string, message: string): OpResult => ({
    ok: false,
    code,
    message,
    event: audit(ctx, {
      ...EMPTY,
      ...meta,
      operation: "proposal.apply",
      result: "blocked",
      reason: `${code}: ${message}`,
    }),
  });

  if (state === "applied") return block("already-applied", "proposal was already applied");
  if (state === "rejected") return block("proposal-rejected", "rejected proposals are never applied");
  if (state !== "approved") return block("approval-required", "no recorded human approval for this proposal");
  const approval = events.find((e) => e.operation === "proposal.approve")!;
  if (approval.proposalHash !== hash || approval.diffHash !== p.diffHash) {
    return block("approval-mismatch", "the approval was given for a different proposal or diff");
  }

  const kb = loadWorkspaceKb(ctx.ws);
  const stale = staleness(kb, p);
  if (stale.length > 0) return block("stale-proposal", stale.join("; "));
  // Re-derive each diff from the live page: only the exact approved text transformation may be written.
  for (const change of p.changes) {
    const current = kb.pages.get(change.page)!.content;
    if (sha256(current) !== change.oldHash) return block("stale-proposal", `page ${change.page} changed`);
    if (unifiedDiff(current, change.newContent, `wiki/${change.page}.md`) !== change.diff) {
      return block("diff-mismatch", `re-derived diff for ${change.page} differs from the approved diff`);
    }
    if (sha256(change.newContent) !== change.newHash)
      return block("diff-mismatch", "new content hash mismatch");
  }

  for (const change of p.changes) write(ctx, join(ctx.ws.wikiDir, `${change.page}.md`), change.newContent);
  const after = loadWorkspaceKb(ctx.ws);
  for (const change of p.changes) {
    if (sha256(after.pages.get(change.page)!.content) !== change.newHash) {
      throw new Error(`post-write verification failed for ${change.page}`);
    }
  }
  const logPath = join(ctx.ws.wikiDir, "log.md");
  const log = after.pages.get("log")?.content ?? "# Operation log\n";
  const day = ctx.clock.now().slice(0, 10);
  write(
    ctx,
    logPath,
    `${log.replace(/\n*$/, "\n")}## [${day}] resolve | ${p.id} ${p.action} for ${p.contradictionId} (${p.severity}); approved by ${approval.actor}, applied by ${ctx.actor}\n`,
  );
  const event = audit(ctx, {
    ...EMPTY,
    ...meta,
    operation: "proposal.apply",
    result: "success",
    reason: `applied approved diff to ${p.changes.map((c) => c.page).join(", ")}`,
  });
  return {
    ok: true,
    code: "applied",
    message: `applied ${p.id} to ${p.changes.map((c) => c.page).join(", ")}`,
    event,
  };
}
