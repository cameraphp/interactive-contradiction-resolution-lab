import { join } from "node:path";
import { PREDICATES } from "../domain/predicates.js";
import { ClaimSchema, type Claim, type ClaimValue, type Source } from "../domain/schemas.js";
import { loadSources, verifyManifest, type ManifestCheck } from "./sources.js";
import { loadWikiPages, parseClaimBlocks, SPECIAL_PAGES, type WikiPage } from "./wiki.js";

export interface KbPaths {
  sourcesDir: string;
  manifestPath: string;
  wikiDir: string;
}

export interface StructuralFinding {
  code:
    | "claim-malformed"
    | "claim-duplicate-id"
    | "predicate-unknown"
    | "value-kind-mismatch"
    | "unit-mismatch"
    | "source-unknown"
    | "citation-line-out-of-range"
    | "citation-text-mismatch"
    | "wikilink-broken"
    | "page-not-indexed"
    | "instruction-like-source-text";
  level: "error" | "warning" | "info";
  message: string;
  page?: string;
  claimId?: string;
  sourceId?: string;
}

export interface KnowledgeBase {
  sources: Map<string, Source>;
  pages: Map<string, WikiPage>;
  claims: Claim[];
  findings: StructuralFinding[];
  manifest: ManifestCheck;
}

export class SourceIntegrityError extends Error {
  constructor(readonly problems: string[]) {
    super(`source manifest check failed: ${problems.join("; ")}`);
  }
}

export function contentPages(pages: Map<string, WikiPage>): WikiPage[] {
  return [...pages.values()].filter((p) => !(SPECIAL_PAGES as readonly string[]).includes(p.id));
}

export function parseValue(raw: string): ClaimValue | null {
  const idx = raw.indexOf(":");
  if (idx < 0) return null;
  const kind = raw.slice(0, idx);
  const body = raw.slice(idx + 1);
  switch (kind) {
    case "string":
      return { kind, value: body };
    case "number":
      return /^-?\d+(\.\d+)?$/.test(body) ? { kind, value: Number(body) } : null;
    case "date":
      return { kind, value: body };
    case "boolean":
      return body === "true" || body === "false" ? { kind, value: body === "true" } : null;
    default:
      return null;
  }
}

export function formatValue(value: ClaimValue): string {
  return `${value.kind}:${String(value.value)}`;
}

// Heuristic only: it labels instruction-like source text for reviewers. The real defence is structural:
// no code path turns source text into an operation (see THREAT_MODEL.md).
const INSTRUCTION_PATTERNS = [
  /^\s*(assistant|system|user|developer)\s*:/i,
  /\bignore\s+(all\s+|any\s+)?(the\s+|previous\s+|prior\s+)?(project\s+)?(rules|instructions)\b/i,
  /\b(approve|overwrite|delete)\b.*\b(wiki|proposals?|claims?)\b/i,
];

/**
 * Load the knowledge base. Fails closed if the source manifest does not match: every later step (citations,
 * evidence, proposals) assumes the sources are exactly the pinned ones.
 */
export function loadKnowledgeBase(paths: KbPaths): KnowledgeBase {
  const manifest = verifyManifest(paths.sourcesDir, paths.manifestPath);
  if (!manifest.ok) throw new SourceIntegrityError(manifest.problems);

  const sources = new Map(loadSources(paths.sourcesDir).map((s) => [s.id, s]));
  const pages = loadWikiPages(paths.wikiDir);
  const findings: StructuralFinding[] = [];
  const claims: Claim[] = [];
  const seen = new Set<string>();

  for (const page of contentPages(pages)) {
    for (const block of parseClaimBlocks(page.id, page.content)) {
      const claimId = block.fields.id;
      const fail = (code: StructuralFinding["code"], message: string) =>
        findings.push({ code, level: "error", message, page: page.id, ...(claimId ? { claimId } : {}) });

      if (block.errors.length > 0 || block.originalText === null) {
        fail(
          "claim-malformed",
          [...block.errors, ...(block.originalText ? [] : ["no quoted original text"])].join("; "),
        );
        continue;
      }
      const f = block.fields;
      const value = parseValue(f.value ?? "");
      const source = sources.get(f.source ?? "");
      const candidate = {
        id: f.id,
        subject: f.subject,
        predicate: f.predicate,
        value,
        ...(f.unit !== undefined ? { unit: f.unit } : {}),
        originalText: block.originalText,
        sourceId: f.source,
        sourceLocation: { line: Number(f.line) },
        sourceDate: source?.date ?? null,
        confidence: Number(f.confidence),
        status: f.status,
        pageRef: page.id,
        ...(f.as_of !== undefined ? { asOf: f.as_of } : {}),
        ...(f.superseded_by !== undefined ? { supersededBy: f.superseded_by } : {}),
        ...(f.resolution !== undefined ? { resolution: f.resolution } : {}),
        ...(f.review !== undefined ? { review: f.review } : {}),
      };
      const parsed = ClaimSchema.safeParse(candidate);
      if (!parsed.success) {
        fail(
          "claim-malformed",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
        continue;
      }
      const claim = parsed.data;
      if (seen.has(claim.id)) {
        fail("claim-duplicate-id", `duplicate claim id ${claim.id}`);
        continue;
      }
      seen.add(claim.id);

      const spec = PREDICATES[claim.predicate];
      if (!spec) {
        fail("predicate-unknown", `predicate "${claim.predicate}" is not registered`);
        continue;
      }
      if (spec.kind !== claim.value.kind) {
        fail("value-kind-mismatch", `${claim.predicate} expects ${spec.kind}, got ${claim.value.kind}`);
        continue;
      }
      if ((spec.unit ?? undefined) !== claim.unit) {
        fail(
          "unit-mismatch",
          `${claim.predicate} expects unit ${spec.unit ?? "(none)"}, got ${claim.unit ?? "(none)"}`,
        );
        continue;
      }
      if (!source) {
        fail("source-unknown", `cites unknown source ${claim.sourceId}`);
        continue;
      }
      const cited = source.lines[claim.sourceLocation.line - 1];
      if (cited === undefined) {
        fail("citation-line-out-of-range", `${claim.sourceId} has no line ${claim.sourceLocation.line}`);
        continue;
      }
      if (!cited.includes(claim.originalText)) {
        fail(
          "citation-text-mismatch",
          `${claim.sourceId} line ${claim.sourceLocation.line} does not contain the quoted original text`,
        );
        continue;
      }
      claims.push(claim);
    }
  }

  const index = pages.get("index");
  const indexed = new Set(index?.links ?? []);
  for (const page of pages.values()) {
    for (const link of page.links) {
      if (!pages.has(link)) {
        findings.push({
          code: "wikilink-broken",
          level: "warning",
          message: `[[${link}]] does not resolve`,
          page: page.id,
        });
      }
    }
  }
  for (const page of contentPages(pages)) {
    if (!indexed.has(page.id)) {
      findings.push({
        code: "page-not-indexed",
        level: "warning",
        message: `${page.id} is missing from index.md`,
        page: page.id,
      });
    }
  }
  for (const source of sources.values()) {
    source.lines.forEach((line, i) => {
      if (INSTRUCTION_PATTERNS.some((re) => re.test(line))) {
        findings.push({
          code: "instruction-like-source-text",
          level: "info",
          message: `line ${i + 1} looks like an instruction; treated as inert source data`,
          sourceId: source.id,
        });
      }
    });
  }

  claims.sort((a, b) => a.id.localeCompare(b.id));
  return { sources, pages, claims, findings, manifest };
}

export function defaultKbPaths(root: string): KbPaths {
  return {
    sourcesDir: join(root, "fixtures", "kb", "sources"),
    manifestPath: join(root, "fixtures", "kb", "sources.manifest.json"),
    wikiDir: join(root, "fixtures", "kb", "wiki"),
  };
}
