/**
 * Minimal line-based unified diff (LCS). Wiki pages are small, so the O(n*m) table is fine, and owning
 * the implementation keeps the output byte-stable: the approval is bound to the hash of this exact text.
 */
type Op = { kind: " " | "-" | "+"; text: string };

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: "-", text: a[i]! });
      i++;
    } else {
      ops.push({ kind: "+", text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "-", text: a[i++]! });
  while (j < m) ops.push({ kind: "+", text: b[j++]! });
  return ops;
}

export function unifiedDiff(oldText: string, newText: string, path: string, context = 3): string {
  const ops = diffOps(splitLines(oldText), splitLines(newText));
  const changeIdx = ops.flatMap((op, idx) => (op.kind === " " ? [] : [idx]));
  if (changeIdx.length === 0) return "";

  // Line numbers (0-based) before each op.
  const oldPos: number[] = [];
  const newPos: number[] = [];
  let o = 0;
  let nn = 0;
  for (const op of ops) {
    oldPos.push(o);
    newPos.push(nn);
    if (op.kind !== "+") o++;
    if (op.kind !== "-") nn++;
  }

  const hunks: Array<[number, number]> = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length, idx + context + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const oldStart = oldCount === 0 ? oldPos[start]! : oldPos[start]! + 1;
    const newStart = newCount === 0 ? newPos[start]! : newPos[start]! + 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.text}`);
  }
  return out.join("\n") + "\n";
}
