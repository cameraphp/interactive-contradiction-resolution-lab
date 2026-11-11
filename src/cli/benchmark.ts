import { join } from "node:path";
import {
  benchmarkPassed,
  formatBenchmarkMarkdown,
  runBenchmark,
  writeBenchmarkReport,
} from "../benchmark/benchmark.js";
import { REPO_ROOT } from "../config.js";

const result = await runBenchmark(REPO_ROOT, 3);
writeBenchmarkReport(result, join(REPO_ROOT, "reports"));
console.log(formatBenchmarkMarkdown(result));
console.log("Written to reports/benchmark-summary.md and reports/benchmark-summary.json");
process.exitCode = benchmarkPassed(result) ? 0 : 1;
