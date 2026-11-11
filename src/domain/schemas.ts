import { z } from "zod";

export const SeveritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_OR_DAY = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

export const ClaimValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), value: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/) }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("date"), value: z.string().regex(ISO_MONTH_OR_DAY) }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
]);
export type ClaimValue = z.infer<typeof ClaimValueSchema>;

/**
 * active      - current knowledge, checked by the detector
 * disputed    - under human review; still checked, reported as "under-review"
 * superseded  - replaced by another claim; kept for audit, ignored by the detector
 * obsolete    - no longer true, no replacement; kept for audit, ignored by the detector
 */
export const ClaimStatusSchema = z.enum(["active", "disputed", "superseded", "obsolete"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimSchema = z
  .object({
    id: z.string().regex(/^CLM-[A-Z0-9-]+$/),
    subject: z.string().regex(/^[a-z]+:[a-z0-9-]+$/),
    predicate: z.string().regex(/^[a-z_]+$/),
    value: ClaimValueSchema,
    unit: z.string().optional(),
    originalText: z.string().min(1),
    sourceId: z.string().regex(/^SRC-\d{3}$/),
    sourceLocation: z.object({ line: z.number().int().positive() }),
    sourceDate: z.string().regex(ISO_DAY).nullable(),
    confidence: z.number().min(0).max(1),
    status: ClaimStatusSchema,
    pageRef: z.string(),
    asOf: z.string().regex(ISO_MONTH_OR_DAY).optional(),
    supersededBy: z.string().optional(),
    resolution: z.string().optional(),
    review: z.string().optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

export const SourceMetaSchema = z
  .object({
    id: z.string().regex(/^SRC-\d{3}$/),
    title: z.string().min(1),
    date: z.string().regex(ISO_DAY),
    kind: z.string().min(1),
    // Principle 9: every fixture must be explicitly labelled synthetic or the loader refuses it.
    synthetic: z.literal("true"),
  })
  .strict();

export interface Source {
  id: string;
  title: string;
  date: string;
  kind: string;
  file: string;
  content: string;
  lines: string[];
}

export const ContradictionTypeSchema = z.enum(["direct", "temporal", "numeric", "status"]);
export type ContradictionType = z.infer<typeof ContradictionTypeSchema>;

export const ProposalActionSchema = z.enum([
  "keep-newer",
  "keep-older",
  "preserve-both-temporal",
  "mark-obsolete",
  "request-human-review",
  "request-new-source",
]);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const SourceRefSchema = z.object({
  claimId: z.string(),
  sourceId: z.string(),
  line: z.number().int().positive(),
  sourceDate: z.string().nullable(),
  page: z.string(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ContradictionSchema = z
  .object({
    id: z.string().regex(/^CTR-[0-9a-f]{8}$/),
    claimIds: z.tuple([z.string(), z.string()]),
    subject: z.string(),
    predicates: z.array(z.string()).min(1),
    type: ContradictionTypeSchema,
    explanation: z.string(),
    confidence: z.number().min(0).max(1),
    severity: SeveritySchema,
    severityRules: z.array(z.string()).min(1),
    sourceRefs: z.array(SourceRefSchema).length(2),
    recommendedAction: ProposalActionSchema,
    state: z.enum(["open", "under-review"]),
  })
  .strict();
export type Contradiction = z.infer<typeof ContradictionSchema>;

export const PageChangeSchema = z
  .object({
    page: z.string(),
    oldHash: z.string().length(64),
    newHash: z.string().length(64),
    newContent: z.string(),
    diff: z.string().min(1),
  })
  .strict();
export type PageChange = z.infer<typeof PageChangeSchema>;

export const ProposalSchema = z
  .object({
    id: z.string().regex(/^PRP-[0-9a-f]{8}$/),
    contradictionId: z.string(),
    severity: SeveritySchema,
    action: ProposalActionSchema,
    rationale: z.string().min(1),
    affectedPages: z.array(z.string()).min(1),
    affectedClaimIds: z.array(z.string()).min(1),
    expectedResult: z.string().min(1),
    expectedOutcome: z.enum(["resolves", "under-review", "follow-up-recorded"]),
    riskWarning: z.string().min(1),
    // Every change in this lab needs a human. HIGH additionally needs an explicit confirmation flag.
    humanApprovalRequired: z.literal(true),
    highSeverityConfirmationRequired: z.boolean(),
    basis: z.object({
      pages: z.record(z.string(), z.string()),
      claims: z.record(z.string(), z.string()),
    }),
    changes: z.array(PageChangeSchema).min(1),
    diffHash: z.string().length(64),
  })
  .strict()
  .refine((p) => p.severity !== "HIGH" || p.highSeverityConfirmationRequired, {
    message: "HIGH severity proposals must require explicit high-severity confirmation",
  });
export type Proposal = z.infer<typeof ProposalSchema>;

export const AuditOperationSchema = z.enum([
  "workspace.init",
  "proposal.create",
  "proposal.approve",
  "proposal.reject",
  "proposal.apply",
  "lint.relint",
]);
export type AuditOperation = z.infer<typeof AuditOperationSchema>;

export const AuditEventSchema = z
  .object({
    seq: z.number().int().positive(),
    timestamp: z.string(),
    operation: AuditOperationSchema,
    actor: z.string().min(1),
    contradictionId: z.string().nullable(),
    proposalId: z.string().nullable(),
    sourceClaimIds: z.array(z.string()),
    oldContentHash: z.string().nullable(),
    newContentHash: z.string().nullable(),
    proposalHash: z.string().nullable(),
    diffHash: z.string().nullable(),
    result: z.enum(["success", "blocked", "failed"]),
    reason: z.string(),
    prevHash: z.string().length(64),
    hash: z.string().length(64),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;
