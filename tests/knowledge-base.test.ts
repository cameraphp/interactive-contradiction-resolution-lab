import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadKnowledgeBase, SourceIntegrityError } from "../src/kb/knowledge-base.js";
import { computeManifest } from "../src/kb/sources.js";
import { cleanupTemps, copyFixtureKb, FIXTURE_PATHS } from "./support/helpers.js";

afterEach(cleanupTemps);

describe("sources and citations", () => {
  it("loads every fixture claim with a verified line-level citation", () => {
    const kb = loadKnowledgeBase(FIXTURE_PATHS);
    expect(kb.claims).toHaveLength(21);
    expect(kb.findings.filter((f) => f.level === "error")).toEqual([]);
    for (const c of kb.claims) {
      const source = kb.sources.get(c.sourceId)!;
      expect(source.lines[c.sourceLocation.line - 1]).toContain(c.originalText);
      expect(c.sourceDate).toBe(source.date);
    }
  });

  it("the committed manifest matches the fixture sources", () => {
    const committed = JSON.parse(readFileSync(FIXTURE_PATHS.manifestPath, "utf8"));
    expect(computeManifest(FIXTURE_PATHS.sourcesDir)).toEqual(committed);
  });

  it("refuses to load when a raw source was modified", () => {
    const kb = copyFixtureKb();
    const file = join(kb.sourcesDir, "SRC-008-security-review-minutes.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("is not an approved", "is an approved"));
    expect(() => loadKnowledgeBase(kb)).toThrow(SourceIntegrityError);
  });

  it("refuses to load when a source is added", () => {
    const kb = copyFixtureKb();
    writeFileSync(join(kb.sourcesDir, "SRC-099-extra.md"), "---\nid: SRC-099\n---\n");
    expect(() => loadKnowledgeBase(kb)).toThrow(/unexpected source/);
  });

  it("tolerates CRLF checkouts without treating them as tampering", () => {
    const kb = copyFixtureKb();
    const file = join(kb.sourcesDir, "SRC-001-acme-kickoff-notes.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    expect(() => loadKnowledgeBase(kb)).not.toThrow();
  });

  it("reports a citation that points at the wrong line and drops the claim", () => {
    const kb = copyFixtureKb();
    const page = join(kb.wikiDir, "acme-project.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("line: 17", "line: 18"));
    const loaded = loadKnowledgeBase(kb);
    expect(loaded.findings).toContainEqual(
      expect.objectContaining({ code: "citation-text-mismatch", claimId: "CLM-ACME-001" }),
    );
    expect(loaded.claims.find((c) => c.id === "CLM-ACME-001")).toBeUndefined();
  });

  it("reports unknown predicates, broken links and unindexed pages", () => {
    const kb = copyFixtureKb();
    const page = join(kb.wikiDir, "ledger-service.md");
    const edited = readFileSync(page, "utf8").replace(
      "predicate: uses_datastore\nvalue: string:redis",
      "predicate: favourite_colour\nvalue: string:redis",
    );
    writeFileSync(page, `${edited}\nSee [[no-such-page]].\n`);
    writeFileSync(join(kb.wikiDir, "orphan.md"), "# Orphan\n");
    const codes = loadKnowledgeBase(kb).findings.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining(["predicate-unknown", "wikilink-broken", "page-not-indexed"]),
    );
  });

  it("rejects sources that are not labelled synthetic", () => {
    const kb = copyFixtureKb();
    const file = join(kb.sourcesDir, "SRC-001-acme-kickoff-notes.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("synthetic: true", "synthetic: false"));
    writeFileSync(kb.manifestPath, JSON.stringify(computeManifest(kb.sourcesDir)));
    expect(() => loadKnowledgeBase(kb)).toThrow();
  });
});
