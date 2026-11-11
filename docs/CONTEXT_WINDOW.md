# Context-window limitation

## The problem

A persistent wiki grows without limit; a model context does not. An approach that "puts the whole wiki in the prompt and
asks for contradictions" stops working once the wiki is larger than one context window. It also gets worse well before
that point, because attention over very long inputs is uneven. Any contradiction workflow for a long-lived knowledge
base has to decide **which claims are looked at together**.

## How this lab handles it

1. **Claims, not pages, are the unit.** Each claim is a small typed record with its own citation, so a batch can hold
   any subset of claims without losing provenance.
2. **An index decides what is related.** Two claims can only conflict if they share a subject and either share a single-valued
   predicate or are joined by an ordering rule. The index therefore groups claims by subject, and inside an oversized subject by
   _predicate cluster_ (predicates linked by ordering rules stay together).
3. **Bounded batches.** Groups are packed into batches under a token budget.
4. **Semantic pruning.** A cluster made only of multi-valued predicates cannot contain a conflict, so it is skipped.
5. **Pairwise windows as a last resort.** A single-valued cluster still larger than the budget is split into
   half-budget chunks, and every pair of chunks is checked. That is complete, but the cost grows quadratically.
6. **Incremental lint.** After an edit, only the batches containing the changed subject are re-checked.
7. **Citations travel with claims.** Every reported contradiction carries both source ids and lines. The experiment
   checks this explicitly.

## The experiment

`npm run experiment:context` (code: `src/context/experiment.ts`, tests: `tests/context.test.ts`).

- A seeded generator builds a synthetic KB: 400 fictional services with 5 claims each, plus one "hot" subject with
  300 multi-valued claims and 60 agreeing weekly throughput restatements, which together exceed any single batch.
  That gives 2,402 claims and ~79k estimated tokens (chars/4, not a real tokenizer).
- 41 conflicting claims are planted (database, owner team, retirement-before-production, and one on the hot subject).
  Each is inserted at a random position _after_ its subject's other claims, as a later source would arrive.
- A full in-memory pass (the "oracle") finds exactly the 41 planted contradictions. This is feasible in code; at this
  size it would not fit in one prompt.
- Each strategy then runs the deterministic detector **inside each batch only**. Recall is measured against the oracle.

### Results

| Budget | Strategy                         | Batches | Largest batch | Found |         Recall |
| -----: | -------------------------------- | ------: | ------------: | ----: | -------------: |
|  8,000 | single prompt (whole KB)         |       1 |        79,133 |     - | exceeds budget |
|  8,000 | sequential chunks (ingest order) |      10 |         7,999 |     4 |           9.8% |
|  8,000 | index-grouped                    |       9 |         7,987 |    41 |         100.0% |
|  1,500 | sequential chunks                |      54 |         1,500 |     0 |           0.0% |
|  1,500 | index-grouped                    |      49 |         1,500 |    41 |         100.0% |

At 8,000 tokens, one subject group exceeded the budget, and 300 multi-valued claims were pruned. At 1,500 tokens the
agreeing throughput cluster also exceeded the budget and needed 3 pairwise batches. Incremental lint after editing one
subject re-checked 1 batch (245 of 2,402 claims at 8,000 tokens; 41 claims at 1,500 tokens).

## What this does and does not show

It shows that **when claims are correctly normalized**, an index makes bounded batches complete for the conflict types
the detector understands, while order-based chunking misses most cross-batch conflicts.

It does **not** show:

- **That a model reasons correctly inside a batch.** The deterministic detector stands in for that step.
- **That chunking removes context limits.** It moves the limit into the index. If extraction gives a claim the wrong
  subject or predicate (for example "Atlas" vs "Atlas service", or "DB engine" vs "primary database"), the related
  claims never meet in a batch, and no batching strategy recovers that.
- **That global reasoning is preserved.** Conflicts that need several subjects at once (for example "every service owned
  by team X is retired, but team X's service Y is in production") need explicit cross-subject rules and indexes.
  Subject grouping alone misses them.
- **That costs stay linear.** Hot subjects and large single-valued clusters fall back to pairwise windows, whose cost
  grows quadratically.
- **That the token estimate is real.** chars/4 is a rough heuristic, not a tokenizer.

## Trade-offs summary

| Choice                    | Benefit                               | Cost / risk                                                |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Subject + predicate index | complete within registered semantics  | only as good as normalization and entity resolution        |
| Semantic pruning          | skips work that cannot find conflicts | wrong cardinality in the registry hides real conflicts     |
| Pairwise windows          | completeness for oversized clusters   | quadratic batch count                                      |
| Incremental lint          | small re-check after each edit        | needs the index kept in sync with every write              |
| Claims as the unit        | citations survive any batching        | page-level context (surrounding prose) is not in the batch |
