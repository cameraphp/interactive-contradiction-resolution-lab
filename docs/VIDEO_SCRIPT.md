# Portfolio video: one-minute script and screen-recording plan

Nothing has been recorded or uploaded. This file holds only the script and the plan. Every on-screen value below
comes from a real local run of this repository on 2026-11-11. Re-check the numbers if the code changes.

## One-minute script (English, about 150 words)

| Time      | Voice-over                                                                                                                                                            | Screen                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 0:00-0:08 | "A knowledge base that an AI agent keeps updating will collect contradictions: two sources, two different answers."                                                   | README title and "What this is" box    |
| 0:08-0:18 | "Finding them is only half the job. This lab keeps detection and resolution separate: deterministic rules flag the conflict, then resolution proposes fixes."         | `npm run lab -- lint` output           |
| 0:18-0:28 | "Each finding gets a severity. A reviewer's authorization is HIGH; a dashboard count is LOW. And the evidence is the exact source line."                              | `show CTR-51796027`                    |
| 0:28-0:40 | "Nothing changes without a human. The reviewer approves one exact diff by quoting its hash, and HIGH severity needs an extra confirmation, so this apply is blocked." | proposal diff, then the BLOCKED lines  |
| 0:40-0:52 | "Every decision, even a blocked one, goes into a hash-chained audit log, and a regression lint confirms the conflict is gone and nothing new appeared."               | `relint` PASS, `audit-log` chain VALID |
| 0:52-1:00 | "All data is synthetic and the demo is deterministic, with no API key and no network. It's a tested reference implementation, not a production product."              | `npm test`: 88 passed                  |

## Screen-recording plan

Setup before recording:

- Terminal at about 120 columns, a large font, light theme. Working directory: the repository root. Keep the
  prompt short (for example, `PS lab>`) so it does not show your user name or home path.
- Run `npm install` beforehand, off camera.
- Run `npm run lab -- init --force` immediately before the CLI segments, so the IDs below match.
- Close any window that shows personal information. Record the terminal and editor only.

| #   | Segment                     | Action                                                                                                                                                                                                                                                                          | What must be visible                                                                             |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Repository overview         | Open the README in the editor. Scroll the "What this is and is not" box, then the Mermaid diagram. Show `fixtures/kb/sources/` and one wiki page with a `claim` block.                                                                                                          | "All data is synthetic"; "not a production system"; a claim block with `source:` and `line:`     |
| 2   | Running the tests           | `npm test`                                                                                                                                                                                                                                                                      | `Test Files 12 passed (12)`, `Tests 88 passed (88)`                                              |
| 3   | Running the demo            | `npm run demo`, then scroll slowly through steps 1-9                                                                                                                                                                                                                            | the injection line "treated as inert data"; step 4 severity groups; the step 9 chain VALID line  |
| 4   | High-severity contradiction | `npm run lab -- show CTR-51796027`                                                                                                                                                                                                                                              | `HIGH status`, `SEV-1 ... authorization`, both quoted source lines with SRC ids and line numbers |
| 5   | Proposed resolution         | `npm run lab -- propose CTR-153b08c5`, then `npm run lab -- proposal PRP-173b3284`                                                                                                                                                                                              | rationale, risk warning, `-status: active` / `+status: superseded`, `Diff hash: be5fc7a65ada`    |
| 6   | Approval gate               | `npm run lab -- apply PRP-173b3284` (BLOCKED), then `npm run lab -- approve PRP-173b3284 --diff-hash be5fc7a65ada --reason "Questionnaire is the later statement" --actor reviewer-a`, then `npm run lab -- apply PRP-173b3284`. Optionally repeat step 7 of the demo for HIGH. | `BLOCKED [approval-required]`, then `OK [approved]`, then `OK [applied]`                         |
| 7   | Audit log                   | `npm run lab -- audit-log`                                                                                                                                                                                                                                                      | the blocked apply row, the approve row with actor `reviewer-a`, `Chain: VALID`                   |
| 8   | Final regression lint       | `npm run lab -- relint`                                                                                                                                                                                                                                                         | `Resolved since last lint: CTR-153b08c5`, `Introduced ... none`, `PASS`                          |

Notes for the edit:

- Keep the claims spoken in the voice-over within what the screen shows. Do not say "production-ready", "secure",
  "certified" or "zero false positives".
- If the benchmark is shown, add the caption "synthetic fixture, 21 claims: not a general accuracy measure".
- Timestamps in `audit-log` come from the real clock in CLI segments. The scripted demo uses a fixed clock (10:00:00).
