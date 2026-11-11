import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/commands.js";
import { fixedClock } from "../src/util/clock.js";
import { cleanupTemps, tempDir } from "./support/helpers.js";

afterEach(cleanupTemps);

function cli(workspace: string) {
  const clock = fixedClock();
  return async (...args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(
      [...args, "--workspace", workspace],
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      {
        clock,
        env: {},
      },
    );
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
}

describe("CLI workflow", () => {
  it("runs the full interactive loop: lint, show, propose, proposal, approve, apply, relint, audit-log", async () => {
    const run = cli(join(tempDir(), "ws"));
    expect((await run("init")).code).toBe(0);

    const lint = await run("lint");
    expect(lint.out).toContain("Contradictions: 6 (6 open, 0 under review) - HIGH 2, MEDIUM 2, LOW 2");
    const acme = /(CTR-[0-9a-f]{8})\s+direct/.exec(lint.out)![1]!;

    const show = await run("show", acme);
    expect(show.out).toContain("> The Acme project uses MySQL as its primary database.");
    expect(show.out).toContain("SEV-2");
    expect(show.out).toContain("Advisor: disabled");

    const propose = await run("propose", acme);
    const keepNewer = /(PRP-[0-9a-f]{8})\s+keep-newer/.exec(propose.out)![1]!;

    const proposal = await run("proposal", keepNewer);
    expect(proposal.out).toContain("-status: active");
    expect(proposal.out).toContain("+status: superseded");
    const hash = /Diff hash:\s+([0-9a-f]{12})/.exec(proposal.out)![1]!;

    expect((await run("apply", keepNewer)).code).toBe(1);
    expect((await run("approve", keepNewer, "--diff-hash", hash)).err).toContain("reason-required");
    const approved = await run(
      "approve",
      keepNewer,
      "--diff-hash",
      hash,
      "--reason",
      "questionnaire is newer",
    );
    expect(approved.code).toBe(0);
    expect((await run("apply", keepNewer)).code).toBe(0);

    const relint = await run("relint");
    expect(relint.code).toBe(0);
    expect(relint.out).toContain(`Resolved since last lint:   ${acme}`);
    expect(relint.out).toContain("Regression verdict:         PASS");

    const audit = await run("audit-log");
    expect(audit.code).toBe(0);
    expect(audit.out).toContain("Chain: VALID");
    expect(audit.out).toMatch(/proposal\.apply\s+blocked/);
    expect(audit.out).toMatch(/proposal\.apply\s+success/);
  });

  it("requires --confirm-high-severity for HIGH proposals", async () => {
    const run = cli(join(tempDir(), "ws"));
    await run("init");
    const high = /(CTR-[0-9a-f]{8})\s+status/.exec(
      (await run("contradictions", "--severity", "HIGH")).out,
    )![1]!;
    const review = /(PRP-[0-9a-f]{8})\s+request-human-review/.exec((await run("propose", high)).out)![1]!;
    const hash = /Diff hash:\s+([0-9a-f]{12})/.exec((await run("proposal", review)).out)![1]!;
    const blocked = await run("approve", review, "--diff-hash", hash, "--reason", "needs owner");
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("high-severity-confirmation-required");
    const ok = await run(
      "approve",
      review,
      "--diff-hash",
      hash,
      "--reason",
      "needs owner",
      "--confirm-high-severity",
    );
    expect(ok.code).toBe(0);
    expect((await run("apply", review)).code).toBe(0);
    const relint = await run("relint");
    expect(relint.out).toContain(`Newly under review:         ${high}`);
  });

  it("shows advisor output only as an advisory note", async () => {
    const run = cli(join(tempDir(), "ws"));
    await run("init");
    const id = /(CTR-[0-9a-f]{8})/.exec((await run("lint")).out)![1]!;
    expect((await run("show", id, "--advisor", "fixture:valid")).out).toContain("(advisory only)");
    expect((await run("show", id, "--advisor", "fixture:injection-obeying")).out).toContain(
      "response REJECTED",
    );
  });

  it("reports a tampered audit log as an integrity error and refuses to continue", async () => {
    const ws = join(tempDir(), "ws");
    const run = cli(ws);
    await run("init");
    const id = /(CTR-[0-9a-f]{8})/.exec((await run("lint")).out)![1]!;
    await run("propose", id);
    const path = join(ws, "audit.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace('"result":"success"', '"result":"blocked"'));
    expect((await run("audit-log", "--verify")).code).toBe(1);
    const relint = await run("relint");
    expect(relint.code).toBe(2);
    expect(relint.err).toContain("INTEGRITY ERROR");
  });

  it("refuses to init over a non-workspace directory and rejects unknown commands", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "precious.txt"), "do not delete");
    const run = cli(dir);
    const init = await run("init", "--force");
    expect(init.code).toBe(2);
    expect(readFileSync(join(dir, "precious.txt"), "utf8")).toBe("do not delete");
    expect((await run("frobnicate")).code).toBe(2);
  });
});
