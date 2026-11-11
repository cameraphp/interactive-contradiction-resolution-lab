# Demo script

Two ways to see the loop: the scripted deterministic demo (`npm run demo`) and the same steps by hand with the CLI.
Neither needs an API key or network access. The one-minute video script and recording plan are in
[docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md).

## 1. Scripted demo

```powershell
npm install
npm run demo            # or: npm run demo:offline  (socket / DNS / fetch calls throw)
```

It recreates `.lab/demo-workspace`, uses a fixed clock (2026-11-11T10:00:00Z) and prints nine steps:

| Step | What happens                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Loads 10 synthetic sources and verifies the sha256 manifest; shows the SRC-010 injection line treated as data                             |
| 2    | Builds the claim index: 21 claims, 21/21 citations verified against the source line text                                                  |
| 3    | Detects 6 contradictions and names the look-alikes that are deliberately not flagged                                                      |
| 4    | Prints findings grouped by severity (HIGH 2, MEDIUM 2, LOW 2)                                                                             |
| 5    | Shows the 5 proposals for the Harbor throughput conflict and the recommended one with its exact diff                                      |
| 6    | Approves that diff by quoting its hash with a reason, then applies it (a scripted reviewer)                                               |
| 7    | Shows Mira's HIGH authorization conflict; apply without approval is BLOCKED, approve without HIGH confirmation is BLOCKED, page unchanged |
| 8    | Regression lint: 1 resolved, 0 introduced, PASS                                                                                           |
| 9    | Audit log table (16 events, including the two blocked attempts), chain VALID, sources unchanged                                           |

The output is byte-identical across runs (checked by `tests/determinism.test.ts`, including in a child process).
The exit code is 0 only if every expected outcome occurred.

## 2. The same loop by hand

IDs are deterministic, so the ones below match a fresh workspace.

```powershell
npm run lab -- init --force
npm run lab -- lint                                   # 6 contradictions grouped by severity
npm run lab -- show CTR-51796027                      # HIGH: Mira reviewer authorization, with evidence lines
npm run lab -- propose CTR-51796027
npm run lab -- proposal <PRP-id of keep-newer>        # exact diff + diff hash
npm run lab -- apply <PRP-id>                         # BLOCKED [approval-required]
npm run lab -- approve <PRP-id> --diff-hash <hash> --reason "test"
                                                      # BLOCKED [high-severity-confirmation-required]

# A MEDIUM resolution, end to end
npm run lab -- propose CTR-153b08c5                   # Acme primary database
npm run lab -- proposal PRP-173b3284                  # keep-newer; diff hash be5fc7a65ada
npm run lab -- approve PRP-173b3284 --diff-hash be5fc7a65ada --reason "Questionnaire is the later statement" --actor reviewer-a
npm run lab -- apply PRP-173b3284
npm run lab -- relint                                 # Resolved: CTR-153b08c5; verdict PASS
npm run lab -- audit-log                              # chain VALID, blocked attempts included
```

### Optional extras

```powershell
npm run lab -- show CTR-51796027 --advisor fixture:valid               # advisory note only
npm run lab -- show CTR-51796027 --advisor fixture:injection-obeying   # response REJECTED
npm run lab -- reject <PRP-id> --reason "draft source"                 # then apply -> BLOCKED [proposal-rejected]
```

### Showing tamper detection

Edit any character inside `.lab/workspace/audit.jsonl`, then:

```powershell
npm run lab -- audit-log --verify     # Chain: BROKEN, line N: content does not match its hash
npm run lab -- relint                 # INTEGRITY ERROR (refuses to append to a broken chain)
npm run lab -- init --force           # start over
```
