# Benchmark

## What it is

A deterministic regression benchmark over the synthetic fixture knowledge base. It checks that the implementation does
what its specification says, on data whose correct answers are known. It is **not** an independent evaluation of
contradiction-detection quality: the fixture is small (10 sources, 21 claims) and was written alongside the detector.

- Labels: [`fixtures/benchmark/expected.json`](fixtures/benchmark/expected.json): 6 contradictions (claim pair,
  type, severity, source ids), 7 compatible look-alike pairs, 1 injection source.
- Code: [`src/benchmark/benchmark.ts`](src/benchmark/benchmark.ts).
- Runs: `npm test` (`tests/benchmark.test.ts`) and `npm run benchmark`. Both write
  [`reports/benchmark-summary.md`](reports/benchmark-summary.md) and `reports/benchmark-summary.json`.
- No timestamps or machine paths appear in the report, so an unchanged implementation produces an identical file.

## Methodology

| Measured property                    | How                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| True contradictions detected         | detected claim pairs ∩ labelled pairs                                                                                            |
| False positives / negatives          | detected-not-labelled / labelled-not-detected                                                                                    |
| Precision / recall                   | computed from the counts above, **on this fixture only**                                                                         |
| Compatible facts not falsely flagged | each labelled compatible pair must be absent from detections                                                                     |
| Type and severity accuracy           | per true positive, against the label                                                                                             |
| Source references                    | source ids match the label **and** each cited line contains the claim's quoted text                                              |
| Proposal validity                    | every generated proposal passes the Zod schema                                                                                   |
| Approved changes applied correctly   | each proposal approved and applied in its own fresh workspace through the real engine; page hash = proposal `newHash`            |
| Declared outcome holds               | after relint: `resolves` → contradiction gone; `under-review` → state under-review; `follow-up-recorded` → still open            |
| No new contradictions                | regression delta has no introduced contradictions and no new structural errors                                                   |
| Rejected changes not applied         | reject, then apply → `proposal-rejected`, page byte-identical                                                                    |
| Stale approvals rejected             | claim edited before approve → `stale-proposal`; page edited between approve and apply → `stale-proposal`                         |
| Other gates                          | apply without approval, HIGH approval without confirmation, wrong diff hash, proposal file edited                                |
| Audit integrity                      | every audit chain produced verifies; a copy with one modified field fails verification                                           |
| Injection                            | instruction-like lines flagged; zero claims from them; zero writes without approval; injection-obeying advisor response rejected |
| Source immutability                  | manifest hash before = after                                                                                                     |
| Repeatability                        | the whole benchmark runs 3 times and the canonical-JSON hashes of the results must be identical                                  |

`benchmarkPassed()` combines all targets. `npm run benchmark` exits 1 if any target is missed.

## Results (local run, 2026-11-11)

From `reports/benchmark-summary.md`:

| Metric                                                         | Result      |
| -------------------------------------------------------------- | ----------- |
| True contradictions detected                                   | 6/6         |
| False positives / false negatives                              | 0 / 0       |
| Precision / recall on this fixture                             | 1.00 / 1.00 |
| Compatible pairs not flagged                                   | 7/7         |
| Type / severity / source references correct                    | 6/6 each    |
| Proposals schema-valid / applied exactly / outcome as declared | 27/27 each  |
| Resolutions that introduced a new contradiction or error       | 0           |
| HIGH proposals requiring explicit confirmation                 | 9/9         |
| All seven approval gates                                       | held        |
| Audit chains verified / tampering detected                     | 32/32 / yes |
| Claims from instruction-like lines / writes without approval   | 0 / 0       |
| Raw sources unchanged                                          | yes         |
| Repeatability (3 runs)                                         | identical   |

**How to read the 1.00 values:** they mean the detector reproduces its own labelled specification on 21 synthetic
claims. They say nothing about recall on real documents, on paraphrased claims, or on predicates outside the registry.

## Context-window experiment

A separate deterministic experiment (`npm run experiment:context`, written to `reports/context-experiment.md`), described
in [docs/CONTEXT_WINDOW.md](docs/CONTEXT_WINDOW.md). Summary:

| Budget | Strategy          | Batches | Found / oracle | Notes                                                     |
| -----: | ----------------- | ------: | -------------: | --------------------------------------------------------- |
|  8,000 | single prompt     |       1 |              - | 79,133 estimated tokens; exceeds the budget               |
|  8,000 | sequential chunks |      10 |         4 / 41 | 9.8% recall                                               |
|  8,000 | index-grouped     |       9 |        41 / 41 | 1 oversized subject split; 300 multi-valued claims pruned |
|  1,500 | sequential chunks |      54 |         0 / 41 |                                                           |
|  1,500 | index-grouped     |      49 |        41 / 41 | 3 pairwise batches for an oversized single-valued cluster |

## Reproducing

```powershell
npm install
npm run benchmark            # exit 0 = all targets met
npm run experiment:context
```
