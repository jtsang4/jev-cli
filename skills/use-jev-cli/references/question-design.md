# Designing questions and state

How to word questions and structure state so the answers are worth branching
on. Load this when a first attempt produces vague or unusable answers, or
before designing a non-obvious evaluation.

Source: https://docs.typesafe.ai/llms.txt — see `concepts/state`,
`primitives`, and the `cookbooks/` entries.

## State holds material, questions hold judgments

> State contains the content and supporting facts. Questions define the
> judgments the model should make about that material.

The refund request, the order record, and the policy text all belong in state.
"Was a refund issued" and "does policy allow it" are questions. A useful
framing from the docs: state is what you would hand a panel of experts before
asking them for a verdict.

**Prefer an object** so every part has a descriptive name. A bare string is
fine only when there is genuinely one piece of text.

```json
{
  "ticket": "Customer says the export button does nothing on Safari.",
  "account": { "plan": "pro", "seats": 12 },
  "policy": "Bugs affecting paid plans are P1 when they block a core workflow."
}
```

Group related parts together when the decision requires comparing them — the
ticket, the account, and the policy belong in one state because severity
depends on all three.

**Reference state fields by path in your instructions**, in backticks, so the
model knows exactly what to judge:

```json
{"type": "boolean", "instructions": "Does `ticket` describe a failure that `policy` classifies as P1 for `account.plan`?"}
```

Pass structured state with `--state-json`:

```bash
jev-cli eval --state-json --state-file ./ticket.json --questions-file ./checks.json
```

## Keep every question atomic

A question should be answerable at a glance by a well-informed person. The
docs' own contrast:

- Good — "Does this message convey urgency?"
- Bad — "Analyze this message and determine the best course of action", which
  "needs slow reasoning, and it is a signal to break the task into small
  questions."

Jev is a System One model. It does not deliberate, search, or plan. If
answering requires several steps of reasoning, it is the wrong shape — not a
wording problem.

## Split composite judgments, combine in your code

> If the judgment you want depends on several independent factors, ask about
> each factor separately and combine the answers with your own logic.

Instead of one "rate this startup pitch" score, ask about market size,
technical feasibility, and differentiation separately, then weight them
yourself:

```json
{
  "market":        {"type": "score", "instructions": "How large is the addressable market?", "criteria": ["niche", "moderate", "large"]},
  "feasibility":   {"type": "score", "instructions": "How technically feasible is this?",    "criteria": ["speculative", "plausible", "proven"]},
  "differentiated":{"type": "score", "instructions": "How differentiated is this?",          "criteria": ["commodity", "some edge", "strong moat"]}
}
```

```bash
jev-cli eval --state-file ./pitch.txt --questions-file ./rubric.json \
  | jq '.market.score * 0.5 + .feasibility.score * 0.3 + .differentiated.score * 0.2'
```

The payoff is maintainability: when priorities shift you change a coefficient,
not a prompt. This is the **composite scoring** pattern.

## Choosing the type

Work from the shape of the answer your code needs.

| Your code needs | Type | Why |
| --- | --- | --- |
| One winner from a fixed set | `choice` | Probabilities sum to 1 across options |
| A position on an ordered rubric | `score` | Fractional position with a level distribution |
| Is this statement true? | `boolean` | Independent P(true) |
| **Which of these apply, possibly several** | **one `boolean` per candidate** | Independent judgments can all be high or all low |

That last row is the one most often got wrong. `choice` forces exactly one
winner even when the truth is "three of these" or "none of these". For
multi-label work — which packages a change touches, which policies a document
violates — fan out one `boolean` per candidate in a single request and
threshold them yourself.

```json
{
  "pkg::api":     {"type": "boolean", "instructions": "Does implementing `requirement` require changes in `packages.api`?"},
  "pkg::billing": {"type": "boolean", "instructions": "Does implementing `requirement` require changes in `packages.billing`?"},
  "pkg::web":     {"type": "boolean", "instructions": "Does implementing `requirement` require changes in `packages.web`?"}
}
```

## Probability is not confidence, and not magnitude

- `boolean` returns **P(true)**. `0.5` means the model is torn between true and
  false — it does **not** mean "medium". For gradations use `score` with named
  levels.
- `choice` and `score` probabilities describe the distribution over options or
  levels. TypeSafe reports a separate **confidence** statistic for them at
  `providerMetadata.typesafe.confidence[questionId]`, visible with `--full`.
- None of it is guaranteed calibrated. Pick thresholds against your own data
  rather than trusting an absolute cutoff.

```bash
jev-cli eval --state-file ./doc.txt --questions-file ./q.json --full \
  | jq '{choice: .answers.topic.choice, confidence: .providerMetadata.typesafe.confidence.topic}'
```

## Budget

State and questions share **~32,000 tokens (~150,000 characters)**, and Jev
accepts text only. Over budget fails with `{"error_type":"max_tokens_exceeded"}`
and HTTP 400.

Two consequences worth internalising:

- You cannot evaluate a corpus directly. Build a compact index — names plus
  short descriptions — and evaluate that. See
  [patterns.md](patterns.md).
- Long criteria descriptions count too. When you have many options, truncate
  their descriptions in the wide pass and spend the budget on a shortlist
  afterwards.
