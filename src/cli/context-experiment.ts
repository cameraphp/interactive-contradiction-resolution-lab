import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../config.js";
import { DEFAULT_CONTEXT_CONFIG, formatContextReport, runContextExperiment } from "../context/experiment.js";

const reports = [8000, 1500].map((budgetTokens) =>
  runContextExperiment({ ...DEFAULT_CONTEXT_CONFIG, budgetTokens }),
);
const text = reports.map(formatContextReport).join("\n");
writeFileSync(join(REPO_ROOT, "reports", "context-experiment.md"), text);
console.log(text);
console.log("Written to reports/context-experiment.md");
