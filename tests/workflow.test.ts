import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proposal } from "../src/domain/schemas.js";
import { sha256 } from "../src/util/hash.js";
import {
  apply,
  approve,
  loadWorkspaceKb,
  propose,
  proposalState,
  reject,
  relint,
  runLint,
  type WorkflowContext,
} from "../src/workflow/engine.js";
import { generateProposals, proposalHash } from "../src/resolve/proposals.js";
import { appendAuditEvent, verifyAuditLog } from "../src/workflow/audit.js";
import { cleanupTemps, freshLab } from "./support/helpers.js";

afterEach(cleanupTemps);

function ctrFor(ctx: WorkflowContext, claimId: string): string {
  return runLint(ctx).contradictions.find((c) => c.claimIds.includes(claimId))!.id;
}

function proposalFor(ctx: WorkflowContext, claimId: string, action: Proposal["action"]): Proposal {
  return propose(ctx, ctrFor(ctx, claimId)).proposals.find((p) => p.action === action)!;
}

function page(ctx: WorkflowContext, id: string): string {
  return readFileSync(join(ctx.ws.wikiDir, `${id}.md`), "utf8");
}

describe("proposal generation", () => {
  it("generates schema-valid proposals with diffs for every contradiction", () => {
    const ctx = freshLab();
    for (const c of runLint(ctx).contradictions) {
      const { proposals } = propose(ctx, c.id);
      expect(proposals.length).toBeGreaterThanOrEqual(3);
      for (const p of proposals) {
        expect(p.humanApprovalRequired).toBe(true);
        expect(p.highSeverityConfirmationRequired).toBe(c.severity === "HIGH");
        expect(p.changes.every((ch) => ch.diff.startsWith("--- a/wiki/"))).toBe(true);
        if (c.severity === "HIGH") expect(p.riskWarning).toMatch(/^HIGH severity/);
      }
      expect(proposals.map((p) => p.action)).toContain("request-human-review");
    }
  });

  it("is idempotent: proposing twice yields the same ids and no duplicate audit events", () => {
    const ctx = freshLab();
    const id = ctrFor(ctx, "CLM-ACME-001");
    const first = propose(ctx, id);
    const second = propose(ctx, id);
    expect(second.proposals.map((p) => p.id)).toEqual(first.proposals.map((p) => p.id));
    expect(second.created).toEqual([]);
  });

  it("offers mark-obsolete (not supersede) for the cross-predicate Atlas lifecycle conflict", () => {
    const ctx = freshLab();
    const actions = propose(ctx, ctrFor(ctx, "CLM-ATLAS-001")).proposals.map((p) => p.action);
    expect(actions.filter((a) => a === "mark-obsolete")).toHaveLength(2);
    expect(actions).not.toContain("keep-newer");
  });
});

describe("approval gate", () => {
  it("applies an approved MEDIUM proposal exactly and resolves the contradiction", () => {
    const ctx = freshLab();
    const ctrId = ctrFor(ctx, "CLM-HARBOR-001");
    const p = proposalFor(ctx, "CLM-HARBOR-001", "preserve-both-temporal");
    expect(apply(ctx, p.id).code).toBe("approval-required");

    expect(
      approve(ctx, p.id, { diffHash: p.diffHash.slice(0, 12), reason: "throughput grew between reviews" }).ok,
    ).toBe(true);
    const result = apply(ctx, p.id);
    expect(result.ok).toBe(true);
    expect(sha256(page(ctx, "harbor-pipeline"))).toBe(p.changes[0]!.newHash);
    expect(page(ctx, "log")).toContain(`resolve | ${p.id} preserve-both-temporal`);

    const { delta } = relint(ctx);
    expect(delta.resolved).toEqual([ctrId]);
    expect(delta.introduced).toEqual([]);
    expect(delta.ok).toBe(true);
    expect(proposalState(ctx.ws, p.id)).toBe("applied");
    expect(apply(ctx, p.id).code).toBe("already-applied");
  });

  it("requires the reviewer to quote the displayed diff hash", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ACME-001", "keep-newer");
    expect(approve(ctx, p.id, { diffHash: "", reason: "ok" }).code).toBe("diff-hash-mismatch");
    expect(approve(ctx, p.id, { diffHash: p.diffHash.slice(0, 8), reason: "ok" }).code).toBe(
      "diff-hash-mismatch",
    );
    expect(approve(ctx, p.id, { diffHash: "f".repeat(12), reason: "ok" }).code).toBe("diff-hash-mismatch");
    expect(approve(ctx, p.id, { diffHash: p.diffHash.slice(0, 12), reason: "  " }).code).toBe(
      "reason-required",
    );
    expect(proposalState(ctx.ws, p.id)).toBe("proposed");
  });

  it("blocks HIGH severity approval without explicit confirmation and never auto-applies", () => {
    const ctx = freshLab();
    const before = page(ctx, "reviewer-access");
    const p = proposalFor(ctx, "CLM-MIRA-001", "keep-newer");
    expect(p.severity).toBe("HIGH");
    expect(apply(ctx, p.id).code).toBe("approval-required");
    const blocked = approve(ctx, p.id, { diffHash: p.diffHash, reason: "access revoked in August" });
    expect(blocked.code).toBe("high-severity-confirmation-required");
    expect(apply(ctx, p.id).code).toBe("approval-required");
    expect(page(ctx, "reviewer-access")).toBe(before);

    expect(
      approve(ctx, p.id, {
        diffHash: p.diffHash,
        reason: "access revoked in August",
        confirmHighSeverity: true,
      }).ok,
    ).toBe(true);
    expect(apply(ctx, p.id).ok).toBe(true);
  });

  it("never applies a rejected proposal and cannot approve it afterwards", () => {
    const ctx = freshLab();
    const before = page(ctx, "acme-project");
    const p = proposalFor(ctx, "CLM-ACME-001", "keep-older");
    expect(reject(ctx, p.id, { reason: "" }).code).toBe("reason-required");
    expect(reject(ctx, p.id, { reason: "questionnaire is a draft but kickoff notes are older" }).ok).toBe(
      true,
    );
    expect(approve(ctx, p.id, { diffHash: p.diffHash, reason: "changed my mind" }).code).toBe(
      "already-rejected",
    );
    expect(apply(ctx, p.id).code).toBe("proposal-rejected");
    expect(page(ctx, "acme-project")).toBe(before);
  });

  it("rejects approval as stale when an underlying claim changed after the proposal", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ACME-001", "keep-newer");
    const path = join(ctx.ws.wikiDir, "acme-project.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("confidence: 0.70", "confidence: 0.75"));
    const result = approve(ctx, p.id, { diffHash: p.diffHash, reason: "newer source" });
    expect(result.code).toBe("stale-proposal");
    expect(result.message).toContain("claim CLM-ACME-003 changed");
  });

  it("rejects application as stale when the page changed between approval and apply", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ACME-001", "keep-newer");
    expect(approve(ctx, p.id, { diffHash: p.diffHash, reason: "newer source" }).ok).toBe(true);
    const path = join(ctx.ws.wikiDir, "acme-project.md");
    const edited = readFileSync(path, "utf8").replace("database engine;", "database engine (edited);");
    writeFileSync(path, edited);
    expect(apply(ctx, p.id).code).toBe("stale-proposal");
    expect(readFileSync(path, "utf8")).toBe(edited);
  });

  it("makes sibling proposals stale once one resolution for the same pages is applied", () => {
    const ctx = freshLab();
    const all = propose(ctx, ctrFor(ctx, "CLM-ACME-001")).proposals;
    const newer = all.find((p) => p.action === "keep-newer")!;
    const older = all.find((p) => p.action === "keep-older")!;
    approve(ctx, newer.id, { diffHash: newer.diffHash, reason: "newer" });
    approve(ctx, older.id, { diffHash: older.diffHash, reason: "older" });
    expect(apply(ctx, newer.id).ok).toBe(true);
    expect(apply(ctx, older.id).code).toBe("stale-proposal");
  });

  it("detects a proposal file edited after creation", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ATLAS-002", "keep-newer");
    const path = join(ctx.ws.proposalsDir, `${p.id}.json`);
    const forged = { ...p, rationale: "forged" };
    writeFileSync(path, JSON.stringify(forged));
    expect(approve(ctx, p.id, { diffHash: p.diffHash, reason: "ok" }).code).toBe("proposal-tampered");
  });

  it("detects a proposal swapped after approval (approval bound to proposal hash)", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ATLAS-002", "keep-newer");
    approve(ctx, p.id, { diffHash: p.diffHash, reason: "ok" });
    const path = join(ctx.ws.proposalsDir, `${p.id}.json`);
    const content = readFileSync(path, "utf8");
    writeFileSync(path, content.replace("status: superseded", "status: obsolete"));
    expect(apply(ctx, p.id).ok).toBe(false);
  });

  it("recomputes the diff before writing, even if the proposal and audit log were forged consistently", () => {
    // Threat-model residual risk: someone with file access rewrites a proposal so its displayed diff no longer
    // matches the content it would write, and appends matching create/approve events. The last line of
    // defence is apply re-deriving the diff from the live page.
    const ctx = freshLab();
    const ctrId = ctrFor(ctx, "CLM-ATLAS-002");
    const real = generateProposals(
      loadWorkspaceKb(ctx.ws),
      runLint(ctx).contradictions.find((c) => c.id === ctrId)!,
    )[0]!;
    const shownDiff = real.changes[0]!.diff.replace("+status: superseded", "+status: superseded (harmless)");
    const forged: Proposal = {
      ...real,
      changes: [{ ...real.changes[0]!, diff: shownDiff }],
      diffHash: sha256(shownDiff),
    };
    writeFileSync(join(ctx.ws.proposalsDir, `${forged.id}.json`), JSON.stringify(forged));
    const ev = {
      actor: "forger",
      contradictionId: ctrId,
      proposalId: forged.id,
      sourceClaimIds: forged.affectedClaimIds,
      oldContentHash: null,
      newContentHash: null,
      proposalHash: proposalHash(forged),
      diffHash: forged.diffHash,
      result: "success" as const,
      reason: "forged",
    };
    appendAuditEvent(ctx.ws.auditPath, { ...ev, operation: "proposal.create" }, ctx.clock);
    appendAuditEvent(ctx.ws.auditPath, { ...ev, operation: "proposal.approve" }, ctx.clock);
    const before = page(ctx, "atlas-service");

    const result = apply(ctx, forged.id);
    expect(result.code).toBe("diff-mismatch");
    expect(page(ctx, "atlas-service")).toBe(before);
  });

  it("records every decision, including blocked attempts, in a valid hash chain", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-MIRA-001", "request-human-review");
    apply(ctx, p.id);
    approve(ctx, p.id, { diffHash: p.diffHash, reason: "needs security owner", confirmHighSeverity: true });
    apply(ctx, p.id);
    relint(ctx);
    const log = verifyAuditLog(ctx.ws.auditPath);
    expect(log.ok).toBe(true);
    const summary = log.events.map((e) => `${e.operation}:${e.result}`);
    expect(summary).toContain("proposal.apply:blocked");
    expect(summary).toContain("proposal.approve:success");
    expect(summary).toContain("proposal.apply:success");
    expect(summary[summary.length - 1]).toBe("lint.relint:success");
    const applied = log.events.find((e) => e.operation === "proposal.apply" && e.result === "success")!;
    expect(applied.oldContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(applied.newContentHash).not.toBe(applied.oldContentHash);
    expect(applied.sourceClaimIds).toEqual(["CLM-MIRA-001", "CLM-MIRA-003"]);
  });
});

describe("regression lint", () => {
  it("every resolving proposal removes its contradiction without introducing a new one", () => {
    const seed = freshLab();
    const contradictions = runLint(seed).contradictions;
    for (const c of contradictions) {
      for (const p of propose(seed, c.id).proposals) {
        const ctx = freshLab();
        propose(ctx, c.id);
        approve(ctx, p.id, { diffHash: p.diffHash, reason: "benchmark", confirmHighSeverity: true });
        expect(apply(ctx, p.id).ok).toBe(true);
        const { report, delta } = relint(ctx);
        expect(delta.introduced).toEqual([]);
        expect(delta.structuralErrorsIntroduced).toEqual([]);
        const after = report.contradictions.find((x) => x.id === c.id);
        if (p.expectedOutcome === "resolves") expect(after).toBeUndefined();
        if (p.expectedOutcome === "under-review") expect(after?.state).toBe("under-review");
        if (p.expectedOutcome === "follow-up-recorded") expect(after?.state).toBe("open");
      }
    }
  });

  it("superseded claims stay in the wiki for audit", () => {
    const ctx = freshLab();
    const p = proposalFor(ctx, "CLM-ACME-001", "keep-newer");
    approve(ctx, p.id, { diffHash: p.diffHash, reason: "newer" });
    apply(ctx, p.id);
    const claim = loadWorkspaceKb(ctx.ws).claims.find((c) => c.id === "CLM-ACME-001")!;
    expect(claim.status).toBe("superseded");
    expect(claim.supersededBy).toBe("CLM-ACME-003");
    expect(claim.resolution).toBe(p.id);
  });
});
