import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { KbPaths } from "../kb/knowledge-base.js";
import { isInside } from "../util/fs.js";

const MARKER = "workspace.json";

export interface Workspace {
  root: string;
  wikiDir: string;
  proposalsDir: string;
  auditPath: string;
  baselinePath: string;
  kb: KbPaths;
  /** Directories the workflow must never write to. */
  protectedDirs: string[];
}

interface WorkspaceFile {
  version: 1;
  sourcesDir: string;
  manifestPath: string;
}

function build(root: string, file: WorkspaceFile): Workspace {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p));
  const sourcesDir = abs(file.sourcesDir);
  const wikiDir = join(root, "wiki");
  return {
    root,
    wikiDir,
    proposalsDir: join(root, "proposals"),
    auditPath: join(root, "audit.jsonl"),
    baselinePath: join(root, "lint-baseline.json"),
    kb: { sourcesDir, manifestPath: abs(file.manifestPath), wikiDir },
    protectedDirs: [sourcesDir],
  };
}

export interface InitOptions {
  seedWikiDir: string;
  sourcesDir: string;
  manifestPath: string;
  force?: boolean;
}

/**
 * Creates a working copy of the seed wiki. Sources are referenced in place and never copied, so there is
 * exactly one immutable copy. `force` only deletes a directory that carries the workspace marker.
 */
export function initWorkspace(rootIn: string, opts: InitOptions): Workspace {
  const root = resolve(rootIn);
  if (isInside(root, opts.sourcesDir) || resolve(opts.sourcesDir) === root) {
    throw new Error("workspace cannot live inside the sources directory");
  }
  if (existsSync(root) && readdirSync(root).length > 0) {
    if (!existsSync(join(root, MARKER))) {
      throw new Error(`${root} is not empty and is not a lab workspace; refusing to touch it`);
    }
    if (!opts.force) throw new Error(`workspace already exists at ${root} (use --force to recreate it)`);
    rmSync(root, { recursive: true, force: true });
  }
  mkdirSync(join(root, "proposals"), { recursive: true });
  cpSync(opts.seedWikiDir, join(root, "wiki"), { recursive: true });
  const file: WorkspaceFile = {
    version: 1,
    sourcesDir: relative(root, resolve(opts.sourcesDir)),
    manifestPath: relative(root, resolve(opts.manifestPath)),
  };
  writeFileSync(join(root, MARKER), `${JSON.stringify(file, null, 2)}\n`);
  return build(root, file);
}

export function openWorkspace(rootIn: string): Workspace {
  const root = resolve(rootIn);
  const marker = join(root, MARKER);
  if (!existsSync(marker)) throw new Error(`no lab workspace at ${root} (run "init" first)`);
  return build(root, JSON.parse(readFileSync(marker, "utf8")) as WorkspaceFile);
}
