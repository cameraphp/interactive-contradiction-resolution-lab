import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../src/config.js";
import { runDemo } from "../src/demo/run-demo.js";
import { computeManifest } from "../src/kb/sources.js";
import { cleanupTemps, FIXTURE_PATHS, tempDir } from "./support/helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTemps();
});

function demoOutput(workspaceRoot: string): { code: number; text: string } {
  const lines: string[] = [];
  const code = runDemo(REPO_ROOT, { out: (t) => lines.push(t) }, { workspaceRoot });
  return { code, text: lines.join("\n") };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

describe("repeatability and isolation", () => {
  it("the demo produces byte-identical output across runs", () => {
    const a = demoOutput(join(tempDir(), "ws"));
    const b = demoOutput(join(tempDir(), "ws"));
    expect(a.code).toBe(0);
    expect(b.text).toBe(a.text);
    expect(a.text).toContain("Demo complete: every expected outcome occurred.");
  });

  it("the demo leaves raw source fixtures byte-for-byte unchanged", () => {
    const before = computeManifest(FIXTURE_PATHS.sourcesDir);
    demoOutput(join(tempDir(), "ws"));
    expect(computeManifest(FIXTURE_PATHS.sourcesDir)).toEqual(before);
    expect(JSON.parse(readFileSync(FIXTURE_PATHS.manifestPath, "utf8"))).toEqual(before);
  });

  it("runs in-process with every network primitive replaced by a throwing stub", () => {
    const attempts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      attempts.push(`fetch ${String(input)}`);
      throw new Error("network blocked");
    });
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function () {
      attempts.push("socket.connect");
      throw new Error("network blocked");
    });
    expect(demoOutput(join(tempDir(), "ws")).code).toBe(0);
    expect(attempts).toEqual([]);
  });

  it("runs as a child process with no API keys in the environment and a network-blocking preload", () => {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
    expect(Object.keys(env).some((k) => /KEY|TOKEN|SECRET/i.test(k))).toBe(false);
    const run = () =>
      spawnSync(
        process.execPath,
        ["--import", "./tests/support/block-network.mjs", "--import", "tsx", "src/cli/demo.ts"],
        { cwd: REPO_ROOT, env, encoding: "utf8", timeout: 60_000 },
      );
    const first = run();
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Demo complete");
    expect(run().stdout).toBe(first.stdout);
  });

  it("no source file reads an API key or opens a network connection", () => {
    const offenders = listFiles(join(REPO_ROOT, "src"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /API_KEY|fetch\(|node:https?|node:net|node:tls/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
