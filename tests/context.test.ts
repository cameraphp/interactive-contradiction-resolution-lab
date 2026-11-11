import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_CONFIG,
  estimateTokens,
  generateLargeKb,
  planIndexedBatches,
  runContextExperiment,
} from "../src/context/experiment.js";

describe("context-window experiment", () => {
  const report = runContextExperiment();

  it("generates a KB that cannot fit in one batch", () => {
    expect(report.singlePrompt.fits).toBe(false);
    expect(report.totals.totalTokens).toBeGreaterThan(5 * DEFAULT_CONTEXT_CONFIG.budgetTokens);
    expect(report.totals.oracleContradictions).toBe(report.totals.planted);
  });

  it("keeps every batch within the budget", () => {
    expect(report.sequential.maxBatchTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_CONFIG.budgetTokens);
    expect(report.indexed.maxBatchTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_CONFIG.budgetTokens);
  });

  it("index-grouped batching finds every oracle contradiction; ingest-order chunking misses most", () => {
    expect(report.indexed.recall).toBe(1);
    expect(report.sequential.recall).toBeLessThan(0.5);
    expect(report.citationsPreserved).toBe(true);
  });

  it("incremental lint re-examines only the batches touching the changed subject", () => {
    expect(report.incremental.batchesRerun).toBe(1);
    expect(report.incremental.claimsReexamined).toBeLessThan(report.incremental.totalClaims / 5);
  });

  it("falls back to pairwise windows for an oversized single-valued cluster, still finding everything", () => {
    const small = runContextExperiment({ ...DEFAULT_CONTEXT_CONFIG, budgetTokens: 1500 });
    expect(small.indexed.pairwiseBatches).toBeGreaterThan(0);
    expect(small.indexed.recall).toBe(1);
    expect(small.indexed.maxBatchTokens).toBeLessThanOrEqual(1500);
  });

  it("is deterministic for a fixed seed", () => {
    expect(runContextExperiment()).toEqual(report);
    const { claims } = generateLargeKb(DEFAULT_CONTEXT_CONFIG);
    const plan = planIndexedBatches(claims, 8000);
    expect(plan.batches.every((b) => b.reduce((t, c) => t + estimateTokens(c), 0) <= 8000)).toBe(true);
  });
});
