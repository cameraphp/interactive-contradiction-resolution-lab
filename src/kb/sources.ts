import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMetaSchema, type Source } from "../domain/schemas.js";
import { normalizeEol, sha256 } from "../util/hash.js";

export interface SourceManifest {
  algorithm: "sha256";
  eol: "lf-normalized";
  files: Record<string, string>;
}

export interface ManifestCheck {
  ok: boolean;
  problems: string[];
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function parseFrontMatter(text: string, file: string): Record<string, string> {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`${file}: missing front matter`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`${file}: unterminated front matter`);
  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx < 0) throw new Error(`${file}: malformed front matter line "${line}"`);
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

export function loadSources(dir: string): Source[] {
  return listSourceFiles(dir).map((file) => {
    const content = normalizeEol(readFileSync(join(dir, file), "utf8"));
    const meta = SourceMetaSchema.parse(parseFrontMatter(content, file));
    return { ...meta, file, content, lines: content.split("\n") };
  });
}

export function computeManifest(dir: string): SourceManifest {
  const files: Record<string, string> = {};
  for (const file of listSourceFiles(dir)) {
    files[file] = sha256(normalizeEol(readFileSync(join(dir, file), "utf8")));
  }
  return { algorithm: "sha256", eol: "lf-normalized", files };
}

/** Sources are immutable: any added, removed or edited file fails the check, and the loader refuses to run. */
export function verifyManifest(dir: string, manifestPath: string): ManifestCheck {
  if (!existsSync(manifestPath)) return { ok: false, problems: [`manifest not found: ${manifestPath}`] };
  const expected = JSON.parse(readFileSync(manifestPath, "utf8")) as SourceManifest;
  const actual = computeManifest(dir);
  const problems: string[] = [];
  for (const [file, hash] of Object.entries(expected.files)) {
    const now = actual.files[file];
    if (now === undefined) problems.push(`missing source: ${file}`);
    else if (now !== hash) problems.push(`modified source: ${file}`);
  }
  for (const file of Object.keys(actual.files)) {
    if (!(file in expected.files)) problems.push(`unexpected source: ${file}`);
  }
  return { ok: problems.length === 0, problems };
}
