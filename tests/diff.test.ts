import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../src/kb/knowledge-base.js";
import { appendOpenQuestion, editClaimBlock } from "../src/kb/wiki.js";
import { unifiedDiff } from "../src/util/diff.js";
import { FIXTURE_PATHS } from "./support/helpers.js";

describe("unified diff", () => {
  it("returns an empty string for identical text", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "x.md")).toBe("");
  });

  it("produces exact hunks with three lines of context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ""].join("\n");
    const after = ["1", "2", "3", "4", "FIVE", "6", "7", "8", "9", ""].join("\n");
    expect(unifiedDiff(before, after, "x.md")).toBe(
      [
        "--- a/x.md",
        "+++ b/x.md",
        "@@ -2,7 +2,7 @@",
        " 2",
        " 3",
        " 4",
        "-5",
        "+FIVE",
        " 6",
        " 7",
        " 8",
        "",
      ].join("\n"),
    );
  });

  it("splits distant changes into separate hunks and handles pure insertions", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n") + "\n";
    const after = before.replace("l2\n", "l2\nNEW\n").replace("l18\n", "");
    const diff = unifiedDiff(before, after, "x.md");
    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).toContain("@@ -1,5 +1,6 @@");
    expect(diff).toContain("+NEW");
    expect(diff).toContain("-l18");
  });

  it("diffs a claim status change as single readable lines", () => {
    const kb = loadKnowledgeBase(FIXTURE_PATHS);
    const page = kb.pages.get("acme-project")!.content;
    const edited = editClaimBlock(page, "CLM-ACME-001", {
      status: "superseded",
      superseded_by: "CLM-ACME-003",
    });
    const diff = unifiedDiff(page, edited, "wiki/acme-project.md");
    const changed = diff.split("\n").filter((l) => /^[-+][^-+]/.test(l));
    expect(changed).toEqual(["-status: active", "+status: superseded", "+superseded_by: CLM-ACME-003"]);
  });

  it("appends open questions without touching claims", () => {
    const kb = loadKnowledgeBase(FIXTURE_PATHS);
    const page = kb.pages.get("ledger-service")!.content;
    const once = appendOpenQuestion(page, "first");
    const twice = appendOpenQuestion(once, "second");
    expect(twice).toContain("## Open questions\n\n- first\n- second\n\n## Related pages");
  });
});
