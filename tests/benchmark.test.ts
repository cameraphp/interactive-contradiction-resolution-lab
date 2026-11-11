import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  benchmarkPassed,
  formatBenchmarkMarkdown,
  runBenchmark,
  writeBenchmarkReport,
} from "../src/benchmark/benchmark.js";
import { REPO_ROOT } from "../src/config.js";

describe("deterministic benchmark", () => {
  it("meets every target on the synthetic fixture, repeatably, and writes the summary report", async () => {
    const result = await runBenchmark(REPO_ROOT, 3);
    // The report is written first so a failure still leaves evidence of what was measured.
    writeBenchmarkReport(result, join(REPO_ROOT, "reports"));

    expect(result.detection).toMatchObject({ truePositives: 6, falsePositives: 0, falseNegatives: 0 });
    expect(result.detection.compatibleNotFlagged).toBe(result.dataset.compatiblePairs);
    expect(result.proposals.total).toBeGreaterThanOrEqual(24);
    expect(result.proposals.runsWithIntroducedContradictions).toBe(0);
    expect(result.gates).toEqual({
      unapprovedApplyBlocked: true,
      highWithoutConfirmationBlocked: true,
      rejectedNotApplied: true,
      staleApprovalRejected: true,
      staleApplyRejected: true,
      tamperedProposalRejected: true,
      wrongDiffHashRejected: true,
    });
    expect(result.injection).toMatchObject({ claimsFromInstructionLines: 0, writesWithoutHumanApproval: 0 });
    expect(result.repeatability.identical).toBe(true);
    expect(benchmarkPassed(result)).toBe(true);
    expect(formatBenchmarkMarkdown(result)).toContain("Overall: all targets met.");
  });
});
