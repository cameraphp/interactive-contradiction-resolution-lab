import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Every write in the lab goes through this guard: the target must be inside the workspace and outside every
 * protected directory (the immutable sources). It is a defence against path mistakes, not an OS sandbox.
 */
export function guardedWrite(
  target: string,
  content: string,
  opts: { workspaceRoot: string; protectedDirs: string[] },
): void {
  const abs = resolve(target);
  if (!isInside(abs, opts.workspaceRoot)) {
    throw new Error(`refusing to write outside the workspace: ${abs}`);
  }
  for (const dir of opts.protectedDirs) {
    if (abs === resolve(dir) || isInside(abs, dir)) {
      throw new Error(`refusing to write inside a protected directory: ${abs}`);
    }
  }
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, abs);
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}
