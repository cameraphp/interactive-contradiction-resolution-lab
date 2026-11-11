# Context-window experiment (synthetic, deterministic)

Generated KB: 2402 claims about 401 fictional subjects, ~79133 estimated tokens (chars/4).
Budget per batch: 8000 tokens. Planted conflicting claims: 41. Full-pass oracle: 41 contradictions.

| Strategy | Batches | Largest batch (tokens) | Contradictions found | Recall vs oracle |
| --- | ---: | ---: | ---: | ---: |
| Single prompt (whole KB) | 1 | 79133 | exceeds budget, not run | - |
| Sequential chunks (ingest order) | 10 | 7999 | 4 | 9.8% |
| Index-grouped (subject + linked predicates) | 9 | 7987 | 41 | 100.0% |

Index-grouped details: 1 subject group(s) exceeded the budget and were split by predicate cluster; 300 multi-valued claims were pruned (they cannot conflict); 0 pairwise batch(es) were needed for clusters still too large.
Incremental lint after editing service:gen-0000: re-ran 1 batch(es), 245 of 2402 claims.
Citations preserved on every reported contradiction: yes.

# Context-window experiment (synthetic, deterministic)

Generated KB: 2402 claims about 401 fictional subjects, ~79133 estimated tokens (chars/4).
Budget per batch: 1500 tokens. Planted conflicting claims: 41. Full-pass oracle: 41 contradictions.

| Strategy | Batches | Largest batch (tokens) | Contradictions found | Recall vs oracle |
| --- | ---: | ---: | ---: | ---: |
| Single prompt (whole KB) | 1 | 79133 | exceeds budget, not run | - |
| Sequential chunks (ingest order) | 54 | 1500 | 0 | 0.0% |
| Index-grouped (subject + linked predicates) | 49 | 1500 | 41 | 100.0% |

Index-grouped details: 1 subject group(s) exceeded the budget and were split by predicate cluster; 300 multi-valued claims were pruned (they cannot conflict); 3 pairwise batch(es) were needed for clusters still too large.
Incremental lint after editing service:gen-0000: re-ran 1 batch(es), 41 of 2402 claims.
Citations preserved on every reported contradiction: yes.
