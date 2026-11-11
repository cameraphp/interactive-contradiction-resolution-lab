import { byAge } from "../detect/detector.js";
import { PREDICATES } from "../domain/predicates.js";
import {
  ProposalSchema,
  type Claim,
  type Contradiction,
  type PageChange,
  type Proposal,
  type ProposalAction,
} from "../domain/schemas.js";
import type { KnowledgeBase } from "../kb/knowledge-base.js";
import { appendOpenQuestion, editClaimBlock } from "../kb/wiki.js";
import { unifiedDiff } from "../util/diff.js";
import { hashOf, sha256 } from "../util/hash.js";

export function claimFingerprint(claim: Claim): string {
  return hashOf(claim);
}

/** Proposal ids derive from the contradiction, the action and the exact page state they were computed on. */
function proposalId(contradictionId: string, action: string, basisHash: string): string {
  return `PRP-${sha256(`${contradictionId}|${action}|${basisHash}`).slice(0, 8)}`;
}

type Edit =
  | { kind: "claim"; claimId: string; set: Record<string, string> }
  | { kind: "open-question"; page: string; text: string };

interface Draft {
  action: ProposalAction;
  /** Distinguishes two drafts with the same action (mark-obsolete on either claim). */
  variant?: string;
  rationale: string;
  expectedResult: string;
  expectedOutcome: Proposal["expectedOutcome"];
  riskWarning: string;
  edits: (id: string) => Edit[];
}

const HIGH_WARNING =
  "HIGH severity: this fact concerns authorization, security or production status. An incorrect choice can grant access or misreport what is running. Verify against the authoritative system of record before approving.";

function drafts(c: Contradiction, older: Claim, newer: Claim): Draft[] {
  const spec = PREDICATES[older.predicate]!;
  const crossPredicate = older.predicate !== newer.predicate;
  const datesDiffer =
    older.sourceDate !== null && newer.sourceDate !== null && older.sourceDate !== newer.sourceDate;
  const out: Draft[] = [];

  if (datesDiffer && !crossPredicate) {
    out.push({
      action: "keep-newer",
      rationale: `${newer.sourceId} (${newer.sourceDate}) is more recent than ${older.sourceId} (${older.sourceDate}).`,
      expectedResult: `${older.id} becomes "superseded" by ${newer.id}; the contradiction no longer appears in lint.`,
      expectedOutcome: "resolves",
      riskWarning:
        "Assumes the newer source is authoritative; a newer document can still be a draft or simply wrong. The superseded claim is kept, not deleted.",
      edits: (id) => [
        {
          kind: "claim",
          claimId: older.id,
          set: { status: "superseded", superseded_by: newer.id, resolution: id },
        },
      ],
    });
    out.push({
      action: "keep-older",
      rationale: `Use when ${older.sourceId} is the more authoritative document despite being older.`,
      expectedResult: `${newer.id} becomes "superseded" by ${older.id}; the contradiction no longer appears in lint.`,
      expectedOutcome: "resolves",
      riskWarning: "Discards the most recent statement. Record why the older source is authoritative.",
      edits: (id) => [
        {
          kind: "claim",
          claimId: newer.id,
          set: { status: "superseded", superseded_by: older.id, resolution: id },
        },
      ],
    });
  }

  if (datesDiffer && crossPredicate) {
    for (const target of [older, newer]) {
      out.push({
        action: "mark-obsolete",
        variant: target.id,
        rationale: `Treat ${target.id} ("${target.originalText}") as no longer true; the other claim stands.`,
        expectedResult: `${target.id} becomes "obsolete"; the ordering rule is satisfied and the contradiction disappears.`,
        expectedOutcome: "resolves",
        riskWarning: `Removes ${target.id} from current knowledge without a replacement claim.`,
        edits: (id) => [{ kind: "claim", claimId: target.id, set: { status: "obsolete", resolution: id } }],
      });
    }
  }

  if (datesDiffer && !crossPredicate && spec.timeVarying) {
    out.push({
      action: "preserve-both-temporal",
      rationale: `"${spec.label}" can change over time; each value may have been true when its source was written.`,
      expectedResult: `Both claims stay active with as_of dates ${older.sourceDate} and ${newer.sourceDate}; lint treats them as time-scoped.`,
      expectedOutcome: "resolves",
      riskWarning:
        "Asserts both values were true at different times. Wrong if one source was simply mistaken; the as_of date is the source date, not a verified effective date.",
      edits: (id) => [
        { kind: "claim", claimId: older.id, set: { as_of: older.sourceDate!, resolution: id } },
        { kind: "claim", claimId: newer.id, set: { as_of: newer.sourceDate!, resolution: id } },
      ],
    });
  }

  out.push({
    action: "request-human-review",
    rationale: "Neither claim can be safely preferred from the available evidence.",
    expectedResult: `Both claims become "disputed" and are reported as under review until a human resolves them.`,
    expectedOutcome: "under-review",
    riskWarning:
      "Changes no facts, but readers must not rely on either claim while disputed. The contradiction stays visible.",
    edits: () => [
      { kind: "claim", claimId: older.id, set: { status: "disputed", review: `required (${c.id})` } },
      { kind: "claim", claimId: newer.id, set: { status: "disputed", review: `required (${c.id})` } },
    ],
  });

  out.push({
    action: "request-new-source",
    rationale: "Obtain a third, authoritative source before choosing between the claims.",
    expectedResult: "An open question is added to each affected page; the contradiction stays open.",
    expectedOutcome: "follow-up-recorded",
    riskWarning:
      "Defers the decision; the contradiction remains open in lint until a new source is ingested.",
    edits: (id) =>
      [...new Set([older.pageRef, newer.pageRef])].map((page) => ({
        kind: "open-question" as const,
        page,
        text: `Find an authoritative source for ${c.subject} ${c.predicates.join(" / ")} (${c.id}, ${id}).`,
      })),
  });
  return out;
}

export function generateProposals(kb: KnowledgeBase, c: Contradiction): Proposal[] {
  const claims = c.claimIds.map((id) => kb.claims.find((cl) => cl.id === id));
  if (claims.some((cl) => cl === undefined)) throw new Error(`claims for ${c.id} not found`);
  const [older, newer] = (claims as Claim[]).sort(byAge) as [Claim, Claim];
  const affectedPages = [...new Set([older.pageRef, newer.pageRef])].sort();

  const basis = {
    pages: Object.fromEntries(affectedPages.map((p) => [p, sha256(kb.pages.get(p)!.content)])),
    claims: Object.fromEntries([older, newer].map((cl) => [cl.id, claimFingerprint(cl)])),
  };
  const basisHash = hashOf(basis);

  return drafts(c, older, newer).map((draft) => {
    const id = proposalId(c.id, draft.variant ? `${draft.action}:${draft.variant}` : draft.action, basisHash);
    const contents = new Map(affectedPages.map((p) => [p, kb.pages.get(p)!.content]));
    for (const edit of draft.edits(id)) {
      if (edit.kind === "claim") {
        const page = kb.claims.find((cl) => cl.id === edit.claimId)!.pageRef;
        contents.set(page, editClaimBlock(contents.get(page)!, edit.claimId, edit.set));
      } else {
        contents.set(edit.page, appendOpenQuestion(contents.get(edit.page)!, edit.text));
      }
    }
    const changes: PageChange[] = affectedPages.flatMap((page) => {
      const oldContent = kb.pages.get(page)!.content;
      const newContent = contents.get(page)!;
      if (newContent === oldContent) return [];
      return [
        {
          page,
          oldHash: sha256(oldContent),
          newHash: sha256(newContent),
          newContent,
          diff: unifiedDiff(oldContent, newContent, `wiki/${page}.md`),
        },
      ];
    });
    const high = c.severity === "HIGH";
    return ProposalSchema.parse({
      id,
      contradictionId: c.id,
      severity: c.severity,
      action: draft.action,
      rationale: draft.rationale,
      affectedPages: changes.map((ch) => ch.page),
      affectedClaimIds: [older.id, newer.id],
      expectedResult: draft.expectedResult,
      expectedOutcome: draft.expectedOutcome,
      riskWarning: high ? `${HIGH_WARNING} ${draft.riskWarning}` : draft.riskWarning,
      humanApprovalRequired: true,
      highSeverityConfirmationRequired: high,
      basis,
      changes,
      diffHash: sha256(changes.map((ch) => ch.diff).join("")),
    });
  });
}

export function proposalHash(p: Proposal): string {
  return hashOf(p);
}
