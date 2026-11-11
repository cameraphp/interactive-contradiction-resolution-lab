import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Works from both src/ (tsx) and dist/ (compiled): each sits one level below the repository root. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
