# Threat model

Scope: this laboratory as shipped. It is a local, single-user, file-based reference implementation running on
synthetic data. It is **not** a production security product, and this document records design intent and tested
behaviour, not a security certification.

## Assets

| Asset                   | Why it matters                                                                |
| ----------------------- | ----------------------------------------------------------------------------- |
| Raw sources             | ground truth for every citation; must stay immutable                          |
| Wiki claims             | the persistent knowledge an agent would rely on                               |
| HIGH-severity facts     | authorization, security and production-status claims (e.g. reviewer approval) |
| Proposals and approvals | the link between "what a human saw" and "what was written"                    |
| Audit log               | evidence of who decided what, and when                                        |

## Trust boundaries

1. **Source content → system.** Untrusted. Sources may contain instruction-like text (SRC-010).
2. **Model advisor → system.** Untrusted. Output is raw text that must pass a strict schema, and even then it is advisory only.
3. **Operator CLI → engine.** Trusted to the extent the operator is. `--actor` is a self-declared label.
4. **Filesystem.** Anyone with write access is outside every control here (see residual risks).

## Threats and controls

| #   | Threat                                                    | Control                                                                                                                                                                     | Tested in                      |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| T1  | Source text instructs the system to write or approve      | no code path parses source text into operations; approval needs an explicit `approve` call with a diff hash                                                                 | `tests/injection.test.ts`      |
| T2  | Source text breaks out of a prompt's data section         | excerpts wrapped in `<source_excerpt>` with `< > &` escaped; system prompt says to ignore embedded instructions                                                             | `tests/injection.test.ts`      |
| T3  | Model output treated as truth or as an action             | strict Zod schema (unknown keys rejected), action allow-list, cited claims must belong to the contradiction, severity can never be lowered, output never reaches the engine | `tests/llm-adapter.test.ts`    |
| T4  | Raw source silently edited, added or removed              | sha256 manifest verified on every load; fail closed                                                                                                                         | `tests/knowledge-base.test.ts` |
| T5  | Wiki claim cites a source that does not say it            | the quoted original text must appear on the cited source line, otherwise the claim is dropped and reported                                                                  | `tests/knowledge-base.test.ts` |
| T6  | High-impact fact overwritten automatically                | every apply needs approval; HIGH also needs `--confirm-high-severity`; claims never deleted                                                                                 | `tests/workflow.test.ts`       |
| T7  | Reviewer approves one diff, a different change is written | approval quotes the diff hash; proposal hash recorded; apply re-derives and compares the diff byte for byte                                                                 | `tests/workflow.test.ts`       |
| T8  | Approval reused after the knowledge base changed (stale)  | basis page hashes and claim fingerprints checked on approve and apply                                                                                                       | `tests/workflow.test.ts`       |
| T9  | Rejected proposal applied later                           | state derived from the audit log; rejected is terminal                                                                                                                      | `tests/workflow.test.ts`       |
| T10 | Audit history edited to hide a decision                   | hash chain verified before every append and by `audit-log`; fail closed                                                                                                     | `tests/audit.test.ts`          |
| T11 | Path mistake writes into sources or outside the workspace | `guardedWrite` rejects both; `init --force` deletes only marker-bearing directories                                                                                         | `tests/cli.test.ts`            |
| T12 | Hidden network calls or credential use                    | no network imports or API-key reads in `src/` (test-enforced); demo run with a network-blocking preload and an env stripped of keys                                         | `tests/determinism.test.ts`    |

## Residual risks (not mitigated here)

- **Hash chaining detects tampering; it does not prevent it.** A writer can truncate the newest events (detectable only
  against an externally stored head hash) or rewrite the entire chain consistently. A writer can also append forged
  events, since nothing is signed.
- **No authentication.** Anyone who can run the CLI can approve as any actor name.
- **Filesystem access defeats the controls.** Someone who can edit the manifest and a source together, or the wiki and
  the audit log together, can produce a consistent forgery.
- **The heuristic injection flag is incomplete.** `instruction-like-source-text` is a reviewer hint matching a few
  patterns. Safety does not depend on it.
- **Prompt-boundary escaping is not a guarantee about a real model.** No real model is called in this lab. A real
  adapter would need adversarial evaluation of its own.
- **The process-level network block is not OS isolation.** The offline check patches Node's socket, DNS and fetch
  primitives inside the process. It does not sandbox the operating system.
- **Multi-page apply is not one atomic transaction.** Every page is validated before any write, and each page is written
  atomically (temporary file + rename), but a crash between two page writes could leave a partial application. The
  next lint would show it, and the proposal would then be stale.
