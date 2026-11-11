import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "../util/hash.js";

export const SPECIAL_PAGES = ["index", "log"] as const;

export interface WikiPage {
  id: string;
  content: string;
  links: string[];
}

export interface RawClaimBlock {
  pageId: string;
  line: number;
  fields: Record<string, string>;
  originalText: string | null;
  errors: string[];
}

export function loadWikiPages(dir: string): Map<string, WikiPage> {
  const pages = new Map<string, WikiPage>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const id = file.slice(0, -3);
    const content = normalizeEol(readFileSync(join(dir, file), "utf8"));
    pages.set(id, { id, content, links: extractLinks(content) });
  }
  return pages;
}

export function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([a-z0-9-]+)\]\]/g)].map((m) => m[1]!);
}

/**
 * Claims live in fenced ```claim blocks, each directly preceded by a blockquote holding the original
 * sentence. Fields are plain "key: value" lines so a status change diffs as a single readable line.
 */
export function parseClaimBlocks(pageId: string, content: string): RawClaimBlock[] {
  const lines = content.split("\n");
  const blocks: RawClaimBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "```claim") continue;
    const start = i;
    const fields: Record<string, string> = {};
    const errors: string[] = [];
    i++;
    while (i < lines.length && lines[i] !== "```") {
      const line = lines[i]!;
      const idx = line.indexOf(": ");
      if (idx <= 0) errors.push(`line ${i + 1}: expected "key: value", got "${line}"`);
      else {
        const key = line.slice(0, idx);
        if (key in fields) errors.push(`line ${i + 1}: duplicate field "${key}"`);
        fields[key] = line.slice(idx + 2).trim();
      }
      i++;
    }
    if (i >= lines.length) errors.push(`line ${start + 1}: unterminated claim block`);

    let j = start - 1;
    while (j >= 0 && lines[j]!.trim() === "") j--;
    const quote: string[] = [];
    while (j >= 0 && lines[j]!.startsWith("> ")) quote.unshift(lines[j--]!.slice(2));
    blocks.push({
      pageId,
      line: start + 1,
      fields,
      originalText: quote.length > 0 ? quote.join(" ") : null,
      errors,
    });
  }
  return blocks;
}

/** Set (or add) fields in the claim block with the given id. Existing keys keep their position. */
export function editClaimBlock(content: string, claimId: string, set: Record<string, string>): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "```claim") continue;
    let end = i + 1;
    while (end < lines.length && lines[end] !== "```") end++;
    const body = lines.slice(i + 1, end);
    if (!body.includes(`id: ${claimId}`)) continue;
    for (const [key, value] of Object.entries(set)) {
      const idx = body.findIndex((l) => l.startsWith(`${key}: `));
      if (idx >= 0) body[idx] = `${key}: ${value}`;
      else body.push(`${key}: ${value}`);
    }
    return [...lines.slice(0, i + 1), ...body, ...lines.slice(end)].join("\n");
  }
  throw new Error(`claim ${claimId} not found`);
}

/** Append a bullet to "## Open questions", creating the section before "## Related pages" if needed. */
export function appendOpenQuestion(content: string, bullet: string): string {
  const lines = content.split("\n");
  const heading = "## Open questions";
  let idx = lines.indexOf(heading);
  if (idx < 0) {
    const related = lines.indexOf("## Related pages");
    const at = related >= 0 ? related : lines.length;
    lines.splice(at, 0, heading, "", `- ${bullet}`, "");
    return lines.join("\n");
  }
  idx++;
  let last = idx;
  while (idx < lines.length && !lines[idx]!.startsWith("## ")) {
    if (lines[idx]!.trim() !== "") last = idx;
    idx++;
  }
  lines.splice(last + 1, 0, `- ${bullet}`);
  return lines.join("\n");
}
