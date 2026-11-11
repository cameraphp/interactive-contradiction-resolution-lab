import { detectContradictions } from "../detect/detector.js";
import { ORDERING_RULES, PREDICATES } from "../domain/predicates.js";
import type { Claim } from "../domain/schemas.js";

/**
 * Context-window experiment. The deterministic detector stands in for "whatever reasons over one batch";
 * the experiment measures only how batching strategy decides which claims are ever seen together. It says
 * nothing about model quality, and chunking does not remove context limits; it moves them into the index.
 */
export interface ContextExperimentConfig {
  seed: number;
  subjects: number;
  plantedContradictions: number;
  budgetTokens: number;
  hotSubjectExtraClaims: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextExperimentConfig = {
  seed: 20261111,
  subjects: 400,
  plantedContradictions: 40,
  budgetTokens: 8000,
  hotSubjectExtraClaims: 300,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function estimateTokens(c: Claim): number {
  const line = `${c.id} ${c.subject} ${c.predicate}=${String(c.value.value)} [${c.sourceId}:${c.sourceLocation.line} ${c.sourceDate}] ${c.originalText}`;
  return Math.ceil(line.length / 4);
}

const DATABASES = ["postgresql", "mysql", "sqlite", "mariadb"];
const TEAMS = ["platform", "data", "payments", "search", "identity", "observability"];

/** Base claims in subject order, then planted conflicting claims ingested last (as a later source would be). */
export function generateLargeKb(cfg: ContextExperimentConfig): { claims: Claim[]; planted: string[] } {
  const rand = mulberry32(cfg.seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const claims: Claim[] = [];
  let n = 0;
  const mk = (
    subject: string,
    predicate: string,
    value: Claim["value"],
    text: string,
    date: string,
  ): Claim => {
    n++;
    const spec = PREDICATES[predicate]!;
    return {
      id: `CLM-GEN-${String(n).padStart(5, "0")}`,
      subject,
      predicate,
      value,
      ...(spec.unit ? { unit: spec.unit } : {}),
      originalText: text,
      sourceId: `SRC-${String(100 + (n % 900)).padStart(3, "0")}`,
      sourceLocation: { line: 10 + (n % 40) },
      sourceDate: date,
      confidence: 0.8,
      status: "active",
      pageRef: subject.replace(":", "-"),
    };
  };

  const base: Array<{ subject: string; db: string; team: string; prodMonth: number }> = [];
  for (let s = 0; s < cfg.subjects; s++) {
    const subject = `service:gen-${String(s).padStart(4, "0")}`;
    const name = subject.slice(8);
    const db = pick(DATABASES);
    const team = pick(TEAMS);
    const prodMonth = 1 + Math.floor(rand() * 6);
    base.push({ subject, db, team, prodMonth });
    const d = `2026-0${prodMonth}-01`;
    claims.push(
      mk(
        subject,
        "primary_database",
        { kind: "string", value: db },
        `The ${name} service uses ${db} as its primary database.`,
        d,
      ),
      mk(
        subject,
        "owner_team",
        { kind: "string", value: team },
        `The ${name} service is owned by the ${team} team.`,
        d,
      ),
      mk(
        subject,
        "daily_throughput",
        { kind: "number", value: 1000 * (1 + Math.floor(rand() * 50)) },
        `The ${name} service processes many records per day.`,
        d,
      ),
      mk(
        subject,
        "uses_datastore",
        { kind: "string", value: "redis" },
        `The ${name} service uses Redis for caching.`,
        d,
      ),
      mk(
        subject,
        "production_start",
        { kind: "date", value: `2026-0${prodMonth}` },
        `The ${name} service entered production in month ${prodMonth}.`,
        d,
      ),
    );
  }

  // One "hot" subject whose group alone exceeds the budget: many compatible multi-valued claims plus a
  // single-valued conflict at the start and end of ingestion.
  const hot = "service:gen-hot";
  claims.push(
    mk(
      hot,
      "primary_database",
      { kind: "string", value: "postgresql" },
      "The gen-hot service uses postgresql as its primary database.",
      "2026-01-05",
    ),
  );
  for (let i = 0; i < cfg.hotSubjectExtraClaims; i++) {
    claims.push(
      mk(
        hot,
        "uses_datastore",
        { kind: "string", value: `store-${i}` },
        `The gen-hot service uses store-${i} for an auxiliary workload.`,
        "2026-02-01",
      ),
    );
  }
  // Weekly status reports restating the same throughput: agreeing, single-valued, and large as a cluster.
  for (let w = 0; w < 60; w++) {
    claims.push(
      mk(
        hot,
        "daily_throughput",
        { kind: "number", value: 5000 },
        `Weekly status ${w + 1}: the gen-hot service processes 5,000 records per day.`,
        "2026-03-01",
      ),
    );
  }

  const planted: string[] = [];
  const plantedTail: Claim[] = [];
  const step = Math.max(1, Math.floor(cfg.subjects / cfg.plantedContradictions));
  for (let k = 0; k < cfg.plantedContradictions; k++) {
    const b = base[(k * step) % base.length]!;
    const name = b.subject.slice(8);
    const variant = k % 3;
    let c: Claim;
    if (variant === 0) {
      const other = DATABASES.find((x) => x !== b.db)!;
      c = mk(
        b.subject,
        "primary_database",
        { kind: "string", value: other },
        `The ${name} service uses ${other} as its primary database.`,
        "2026-09-01",
      );
    } else if (variant === 1) {
      const other = TEAMS.find((x) => x !== b.team)!;
      c = mk(
        b.subject,
        "owner_team",
        { kind: "string", value: other },
        `The ${name} service is owned by the ${other} team.`,
        "2026-09-01",
      );
    } else {
      const retired = `2025-${String(1 + (k % 9)).padStart(2, "0")}`;
      c = mk(
        b.subject,
        "retired_on",
        { kind: "date", value: retired },
        `The ${name} service was retired in ${retired}.`,
        "2026-09-01",
      );
    }
    plantedTail.push(c);
    planted.push(c.id);
  }
  // A later source can arrive at any point after the claim it contradicts. Insert each planted claim at a
  // random position after its subject's base claims (not all at the end, which would be a worst case).
  const ordered = [...claims];
  for (const c of plantedTail) {
    const lastOfSubject = ordered.map((x) => x.subject).lastIndexOf(c.subject);
    const at = lastOfSubject + 1 + Math.floor(rand() * (ordered.length - lastOfSubject));
    ordered.splice(at, 0, c);
  }
  ordered.push(
    mk(
      hot,
      "primary_database",
      { kind: "string", value: "mysql" },
      "The gen-hot service uses mysql as its primary database.",
      "2026-09-02",
    ),
  );
  return { claims: ordered, planted };
}

const sum = (cs: Claim[]) => cs.reduce((t, c) => t + estimateTokens(c), 0);

function packSequential(units: Claim[][], budget: number): Claim[][] {
  const batches: Claim[][] = [];
  let current: Claim[] = [];
  let used = 0;
  for (const unit of units) {
    const size = sum(unit);
    if (used + size > budget && current.length > 0) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(...unit);
    used += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function detectAcross(batches: Claim[][]): Set<string> {
  const found = new Set<string>();
  for (const b of batches) for (const c of detectContradictions(b)) found.add(c.id);
  return found;
}

/** Predicates joined by an ordering rule must be checked together. */
function predicateClusters(claims: Claim[]): Claim[][] {
  const clusterOf = (p: string) => {
    const rule = ORDERING_RULES.find((r) => r.earlier === p || r.later === p);
    return rule ? rule.id : p;
  };
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    const key = clusterOf(c.predicate);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}

export interface IndexedPlan {
  batches: Claim[][];
  oversizedGroups: number;
  prunedClaims: number;
  pairwiseBatches: number;
}

export function planIndexedBatches(claims: Claim[], budget: number): IndexedPlan {
  const bySubject = new Map<string, Claim[]>();
  for (const c of claims) bySubject.set(c.subject, [...(bySubject.get(c.subject) ?? []), c]);
  const units: Claim[][] = [];
  const extra: Claim[][] = [];
  let oversizedGroups = 0;
  let prunedClaims = 0;
  let pairwiseBatches = 0;

  for (const subject of [...bySubject.keys()].sort()) {
    const group = bySubject.get(subject)!;
    if (sum(group) <= budget) {
      units.push(group);
      continue;
    }
    oversizedGroups++;
    for (const cluster of predicateClusters(group)) {
      const onlyMany = cluster.every((c) => PREDICATES[c.predicate]!.cardinality === "many");
      const inRule = cluster.some((c) =>
        ORDERING_RULES.some((r) => r.earlier === c.predicate || r.later === c.predicate),
      );
      if (onlyMany && !inRule) {
        prunedClaims += cluster.length; // multi-valued values never conflict with each other
        continue;
      }
      if (sum(cluster) <= budget) {
        units.push(cluster);
        continue;
      }
      // Still too large: compare every pair of half-budget chunks. Complete, but quadratic in chunk count.
      const chunks = packSequential(
        cluster.map((c) => [c]),
        Math.floor(budget / 2),
      );
      for (let i = 0; i < chunks.length; i++) {
        for (let j = i + 1; j < chunks.length; j++) {
          extra.push([...chunks[i]!, ...chunks[j]!]);
          pairwiseBatches++;
        }
      }
    }
  }
  return {
    batches: [...packSequential(units, budget), ...extra],
    oversizedGroups,
    prunedClaims,
    pairwiseBatches,
  };
}

export interface ContextExperimentReport {
  config: ContextExperimentConfig;
  totals: {
    claims: number;
    subjects: number;
    totalTokens: number;
    oracleContradictions: number;
    planted: number;
  };
  singlePrompt: { tokens: number; budget: number; fits: boolean };
  sequential: { batches: number; maxBatchTokens: number; found: number; recall: number };
  indexed: {
    batches: number;
    maxBatchTokens: number;
    found: number;
    recall: number;
    oversizedGroups: number;
    prunedClaims: number;
    pairwiseBatches: number;
  };
  incremental: {
    changedSubject: string;
    batchesRerun: number;
    claimsReexamined: number;
    totalClaims: number;
  };
  citationsPreserved: boolean;
}

export function runContextExperiment(
  cfg: ContextExperimentConfig = DEFAULT_CONTEXT_CONFIG,
): ContextExperimentReport {
  const { claims, planted } = generateLargeKb(cfg);
  const oracle = detectContradictions(claims); // feasible in code; impossible in one prompt at this size
  const oracleIds = new Set(oracle.map((c) => c.id));
  const recall = (found: Set<string>) =>
    oracleIds.size === 0 ? 1 : [...found].filter((id) => oracleIds.has(id)).length / oracleIds.size;
  const maxTokens = (bs: Claim[][]) => Math.max(...bs.map(sum));

  const sequentialBatches = packSequential(
    claims.map((c) => [c]),
    cfg.budgetTokens,
  );
  const sequentialFound = detectAcross(sequentialBatches);
  const plan = planIndexedBatches(claims, cfg.budgetTokens);
  const indexedFound = detectAcross(plan.batches);

  const changedSubject = claims.find((c) => c.id === planted[0])!.subject;
  const rerun = plan.batches.filter((b) => b.some((c) => c.subject === changedSubject));

  const reported = plan.batches.flatMap((b) => detectContradictions(b));
  const byId = new Map(claims.map((c) => [c.id, c]));
  const citationsPreserved = reported.every((c) =>
    c.sourceRefs.every((r) => byId.get(r.claimId)?.sourceId === r.sourceId && r.line > 0),
  );

  return {
    config: cfg,
    totals: {
      claims: claims.length,
      subjects: new Set(claims.map((c) => c.subject)).size,
      totalTokens: sum(claims),
      oracleContradictions: oracleIds.size,
      planted: planted.length + 1,
    },
    singlePrompt: { tokens: sum(claims), budget: cfg.budgetTokens, fits: sum(claims) <= cfg.budgetTokens },
    sequential: {
      batches: sequentialBatches.length,
      maxBatchTokens: maxTokens(sequentialBatches),
      found: sequentialFound.size,
      recall: recall(sequentialFound),
    },
    indexed: {
      batches: plan.batches.length,
      maxBatchTokens: maxTokens(plan.batches),
      found: indexedFound.size,
      recall: recall(indexedFound),
      oversizedGroups: plan.oversizedGroups,
      prunedClaims: plan.prunedClaims,
      pairwiseBatches: plan.pairwiseBatches,
    },
    incremental: {
      changedSubject,
      batchesRerun: rerun.length,
      claimsReexamined: rerun.reduce((t, b) => t + b.length, 0),
      totalClaims: claims.length,
    },
    citationsPreserved,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatContextReport(r: ContextExperimentReport): string {
  return [
    "# Context-window experiment (synthetic, deterministic)",
    "",
    `Generated KB: ${r.totals.claims} claims about ${r.totals.subjects} fictional subjects, ~${r.totals.totalTokens} estimated tokens (chars/4).`,
    `Budget per batch: ${r.config.budgetTokens} tokens. Planted conflicting claims: ${r.totals.planted}. Full-pass oracle: ${r.totals.oracleContradictions} contradictions.`,
    "",
    "| Strategy | Batches | Largest batch (tokens) | Contradictions found | Recall vs oracle |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| Single prompt (whole KB) | 1 | ${r.singlePrompt.tokens} | ${r.singlePrompt.fits ? "fits" : "exceeds budget, not run"} | - |`,
    `| Sequential chunks (ingest order) | ${r.sequential.batches} | ${r.sequential.maxBatchTokens} | ${r.sequential.found} | ${pct(r.sequential.recall)} |`,
    `| Index-grouped (subject + linked predicates) | ${r.indexed.batches} | ${r.indexed.maxBatchTokens} | ${r.indexed.found} | ${pct(r.indexed.recall)} |`,
    "",
    `Index-grouped details: ${r.indexed.oversizedGroups} subject group(s) exceeded the budget and were split by predicate cluster; ${r.indexed.prunedClaims} multi-valued claims were pruned (they cannot conflict); ${r.indexed.pairwiseBatches} pairwise batch(es) were needed for clusters still too large.`,
    `Incremental lint after editing ${r.incremental.changedSubject}: re-ran ${r.incremental.batchesRerun} batch(es), ${r.incremental.claimsReexamined} of ${r.incremental.totalClaims} claims.`,
    `Citations preserved on every reported contradiction: ${r.citationsPreserved ? "yes" : "NO"}.`,
    "",
  ].join("\n");
}
