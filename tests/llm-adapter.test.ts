import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config.js";
import { loadKnowledgeBase } from "../src/kb/knowledge-base.js";
import { lint } from "../src/lint/lint.js";
import {
  advisorFromSetting,
  FixtureAdvisor,
  loadAdvisorFixtures,
  runAdvisor,
  type ContradictionAdvisor,
} from "../src/llm/advisor.js";
import { FIXTURE_PATHS } from "./support/helpers.js";

const kb = loadKnowledgeBase(FIXTURE_PATHS);
const contradictions = lint(kb).contradictions;
const high = contradictions.find((c) => c.severity === "HIGH")!;
const fixtures = loadAdvisorFixtures(join(REPO_ROOT, "fixtures", "llm", "advisor-responses.json"));
const run = (name: string) => runAdvisor(new FixtureAdvisor(fixtures[name]!, high, name), kb, high);

describe("optional advisor adapter", () => {
  it("is disabled by default and needs no API key", async () => {
    expect(advisorFromSetting(undefined, fixtures, high)).toBeNull();
    expect(advisorFromSetting("", fixtures, high)).toBeNull();
    expect(advisorFromSetting("disabled", fixtures, high)).toBeNull();
    expect(await runAdvisor(null, kb, high)).toEqual({ status: "disabled" });
  });

  it("refuses unsupported settings instead of guessing a provider", () => {
    expect(() => advisorFromSetting("openai:gpt", fixtures, high)).toThrow(/unsupported advisor/);
    expect(() => advisorFromSetting("fixture:does-not-exist", fixtures, high)).toThrow(/unsupported advisor/);
  });

  it("accepts a schema-valid response as an advisory note only", async () => {
    const r = await run("valid");
    expect(r.status).toBe("advisory");
    if (r.status === "advisory") {
      expect(r.suggestion.suggestedAction).toBe("request-human-review");
      expect(r.notes.join()).toContain("advisory only");
    }
  });

  it("never lets the advisor lower the deterministic severity", async () => {
    const r = await run("severity-downgrade");
    expect(r.status).toBe("advisory");
    if (r.status === "advisory") expect(r.notes.join()).toContain("lower than deterministic HIGH; ignored");
  });

  it.each([
    "malformed-json",
    "unsupported-action",
    "injection-obeying",
    "unknown-claim",
    "wrong-contradiction",
  ])("rejects the %s response", async (name) => {
    expect((await run(name)).status).toBe("rejected");
  });

  it("turns an advisor failure into a rejection, not a crash", async () => {
    const failing: ContradictionAdvisor = {
      name: "failing",
      complete: async () => {
        throw new Error("simulated outage");
      },
    };
    const r = await runAdvisor(failing, kb, high);
    expect(r).toEqual({
      status: "rejected",
      advisor: "failing",
      reasons: ["advisor call failed: simulated outage"],
    });
  });
});
