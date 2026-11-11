import { REPO_ROOT } from "../config.js";
import { runDemo } from "../demo/run-demo.js";

process.exitCode = runDemo(REPO_ROOT, { out: (text) => console.log(text) });
