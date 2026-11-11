# Changelog

## 0.1.0 - 2026-11-11 (local, unpublished)

Initial reference implementation.

- Synthetic knowledge base: 10 immutable sources (sha256 manifest), 7 wiki pages, index and operation log, 21 claims
  with line-level citations, 6 intentional contradictions (direct, temporal, numeric, status; 2 each of HIGH, MEDIUM
  and LOW) and 7 compatible look-alike pairs.
- Deterministic detector over normalized claims with a predicate registry (cardinality, category, time-varying),
  date-precision intervals and explicit cross-predicate ordering rules.
- Published severity rules SEV-1..SEV-5, with the applied rules shown for each finding.
- Resolution proposals (keep-newer, keep-older, mark-obsolete, preserve-both-temporal, request-human-review,
  request-new-source) with rationale, risk warning, expected outcome and exact unified diff.
- Approval workflow: diff-hash-bound approvals, mandatory reasons, explicit HIGH-severity confirmation, stale-proposal
  and tampered-proposal rejection, terminal rejection, byte-exact application, regression lint.
- Append-only hash-chained audit log with fail-closed appends; proposal state derived from the log.
- Optional, disabled-by-default advisor interface with strict response validation and offline fixtures, including
  prompt-injection and malformed cases.
- Context-window batching experiment; deterministic benchmark with a generated summary report.
- CLI (`npm run lab`), deterministic demo (`npm run demo`, `npm run demo:offline`), 88 Vitest tests.
