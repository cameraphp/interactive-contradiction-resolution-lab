import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/config.js";
import type { Claim } from "../../src/domain/schemas.js";
import { defaultKbPaths } from "../../src/kb/knowledge-base.js";
import { fixedClock } from "../../src/util/clock.js";
import { initLabWorkspace, type WorkflowContext } from "../../src/workflow/engine.js";

export const FIXTURE_PATHS = defaultKbPaths(REPO_ROOT);

export function claim(overrides: Partial<Claim> & Pick<Claim, "id" | "predicate" | "value">): Claim {
  return {
    subject: "service:test",
    originalText: "synthetic test claim",
    sourceId: "SRC-001",
    sourceLocation: { line: 1 },
    sourceDate: "2026-01-01",
    confidence: 0.9,
    status: "active",
    pageRef: "test-page",
    ...overrides,
  };
}

const temps: string[] = [];

export function tempDir(prefix = "icrl-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A writable copy of the fixture KB, for tests that must tamper with sources or pages. */
export function copyFixtureKb(): { root: string; sourcesDir: string; manifestPath: string; wikiDir: string } {
  const root = tempDir("icrl-kb-");
  cpSync(join(REPO_ROOT, "fixtures", "kb"), join(root, "kb"), { recursive: true });
  return {
    root,
    sourcesDir: join(root, "kb", "sources"),
    manifestPath: join(root, "kb", "sources.manifest.json"),
    wikiDir: join(root, "kb", "wiki"),
  };
}

/** A fresh lab workspace (copy of the seed wiki, sources referenced read-only) with a deterministic clock. */
export function freshLab(actor = "test-operator"): WorkflowContext {
  return initLabWorkspace(
    join(tempDir("icrl-ws-"), "ws"),
    {
      seedWikiDir: FIXTURE_PATHS.wikiDir,
      sourcesDir: FIXTURE_PATHS.sourcesDir,
      manifestPath: FIXTURE_PATHS.manifestPath,
    },
    fixedClock(),
    actor,
  );
}

export function cleanupTemps(): void {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
}
