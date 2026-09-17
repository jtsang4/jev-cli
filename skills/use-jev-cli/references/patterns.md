# Patterns for bigger problems

Architectures for work that does not fit one question or one request. Load this
when the candidate set is large, when the material exceeds the token budget, or
when a single evaluation is not decisive enough to act on.

Source: https://docs.typesafe.ai/llms.txt — see `patterns/` and `cookbooks/`.
Measurements quoted here are TypeSafe's.

## Speculative fan-out

Everything judged against the same state goes in one request. Batching 13
questions is measured at **11.5x cheaper and 9.6x faster** than 13 requests,
with identical answers, so *asking a question you might not need is close to
free*.

Ask what your code *might* need and throw away the unused answers. Chaining is
the exception:

> Two requests are the exception, not the rule.

A second call is justified only when you cannot construct it without the first
answer — which is exactly what the shortlist pattern below does.

## Confidence-gated routing

Act automatically when the model is sure and escalate when it is not, instead
of forcing a decision every time.

```bash
jev-cli eval --state-file ./ticket.txt --questions-file ./route.json --compact > /tmp/r.json
p=$(jq -r '.urgent.probability' /tmp/r.json)
if   (( $(echo "$p > 0.85" | bc -l) )); then page_oncall
elif (( $(echo "$p < 0.15" | bc -l) )); then file_ticket
else                                        ask_a_human
fi
```

Pair the decision question with **gate** questions that test whether the
decision applies at all. TypeSafe's skill-suggestion recipe rides three gate
`boolean`s alongside the main `choice`, averages them, and abandons the whole
pipeline below `0.30` — which is how "none of these apply" gets represented
honestly rather than being forced into a winner.

## Two-stage shortlisting

For a large candidate set, read widely and cheaply, then narrowly and
expensively. TypeSafe's skill-suggestion cookbook selects among **182 skills**
this way:

1. **Wide pass** — one `choice` whose criteria maps all 182 names to
   descriptions truncated to ~60 characters, plus the gate questions. One
   request.
2. **Shortlist** — take the top 3 by probability.
3. **Narrow pass** — a second `choice` over only those 3, now with full
   descriptions plus the first ~700 characters of each candidate's own
   document, plus one `boolean` per candidate judged independently so all three
   can come back low.

Measured effect in their harness: wrong loads fell 16.8% → 7.3%, needless loads
9.8% → 4.0%.

A single `choice` comfortably holds 182 options. Past a few times that, chunk
the roster, rank each chunk, then run the shortlist stage over the chunk
winners.

## Hierarchical classification

When labels form a real hierarchy — taxonomies, filesystems, **codebases**, org
charts — do not flatten it. Ask one small `choice` over the direct children of
the current node and walk down.

- **Greedy**: take the best child each step. Cheap, but "one early mistake
  cannot be recovered."
- **Beam search**: keep `K` paths alive and expand all frontiers. Because
  evaluation is parallel, "extra exploration adds little wall-clock latency."

Rank paths by a length-normalised geometric mean so shallow and deep leaves
compete fairly:

```
path_score = product(edge_probabilities) ** (1 / decisions)
```

Skip levels with a single child — they cost a request and skew the score.
Beyond ~10 levels use `exp(mean(log(p)))` to avoid precision loss. In
TypeSafe's benchmarks beam search (K=3) hit 4 of 4 expected leaves where greedy
hit 2.

## Worked example: which packages does this requirement touch?

Combines several of the above, and shows the shape for any "search a repo"
question. The code itself never goes to the model — only a prebuilt index.

**1. Build a compact index** (once, cached — plain shell, no model involved):

```bash
jq -n '{packages: $ARGS.named}' \
  --argjson api '"REST layer, routing and auth"' \
  --argjson billing '"invoice model and charge calculation"' \
  --argjson pdf '"PDF rendering and templates"' > /tmp/index.json
```

In practice generate this from each package's `package.json` description and
README first paragraph.

**2. State = requirement + index. Questions = one `boolean` per package.**
Multi-label, so `boolean` fan-out rather than `choice`:

```bash
jq -s '{requirement: .[0], packages: .[1].packages}' \
  <(jq -Rs . <<< "Let users export invoices as PDF") /tmp/index.json > /tmp/state.json

jev-cli eval --state-json --state-file /tmp/state.json \
             --questions-file /tmp/pkg-questions.json --compact \
  | jq 'to_entries | map(select(.value.probability > 0.6) | .key)'
```

**3. Scale up** when there are many packages: group them by area, `choice` the
area first, then fan out `boolean`s within it. For a deep monorepo, walk the
directory tree with beam search.

**4. Then hand the shortlist to a real reasoning model** to actually plan the
change. Jev narrows the search space; it does not design the edit.

## Related cookbooks

All under https://docs.typesafe.ai/cookbooks/ :

| Cookbook | Useful for |
| --- | --- |
| `parallel_questions` | The batching economics in detail |
| `skill_suggestion` | Selection among many candidates, with gates |
| `hierarchical_classification` | Taxonomy and codebase traversal |
| `rerank_typesafe` | Reordering retrieval results |
| `semantic_find` | Line-by-line search within a document |
| `classifying_rag_passages` | Filtering retrieved passages |
| `citation_check` | Verifying claims against sources |
| `llm_guardrails` | Gating another model's output |
| `consistency_noul_cookbook` | Self-consistency when one answer is not stable enough |
