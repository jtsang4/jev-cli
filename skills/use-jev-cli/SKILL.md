---
name: use-jev-cli
description: Evaluate text or structured state against typed questions using jev-cli, which calls TypeSafe AI's Jev model for fast structured decisions — classification, routing, rubric scoring, and automated verification — returning JSON answers instead of prose. Use when you need a machine-readable verdict (a category, a 0-1 truth probability, or a rubric score) rather than generated text, or when checking many independent properties of the same content at once. Not for generating, summarizing, or rewriting text.
compatibility: Requires the jev-cli binary on PATH and a configured provider API key.
metadata:
  requires:
    bins: ["jev-cli"]
---

# Using jev-cli

`jev-cli` asks **Jev**, a "System One" evaluation model, to judge one shared
**state** against a set of typed **questions**. It returns structured JSON — a
choice, a score, or a probability — never prose.

Reach for it when you need a decision your code can branch on. It is far faster
and cheaper than a full LLM call (priced per input token, with zero output
tokens), so checking ten properties of a diff, a log, or a support transcript
is cheap.

Do **not** use it to write, summarize, translate, or rewrite anything. It
cannot produce text.

Just run the evaluation. There is no setup check to perform first — `eval`
fails fast with an actionable message and a distinct exit code when something
is wrong, and `jev-cli doctor` is the diagnostic you reach for *then*, not
before every call.

## Running an evaluation

```bash
jev-cli eval --state <text> --questions <json>
```

```bash
jev-cli eval -s "The support agent issued a full refund of \$40 and apologized." -q '{
  "refunded": {"type": "boolean", "instructions": "Was a refund issued?"},
  "tone":     {"type": "choice",  "instructions": "What tone did the agent use?",
               "criteria": {"warm": "friendly and personal", "curt": "terse or dismissive"}},
  "quality":  {"type": "score",   "instructions": "Rate how well this was handled.",
               "criteria": ["poor", "acceptable", "excellent"]}
}'
```

```json
{
  "refunded": { "type": "boolean", "probability": 0.99 },
  "tone": { "type": "choice", "choice": "warm", "probabilities": { "curt": 0.02, "warm": 0.98 } },
  "quality": { "type": "score", "score": 1.78, "probabilities": { "0": 0, "1": 0.22, "2": 0.78 } }
}
```

That inline form is right for a sentence you are writing yourself. For anything
that already exists in a file or in a command's output, read **Passing input**
next — it is the thing most callers get wrong.

## Passing input: keep content out of the command line

**Default to `--state-file` / `--questions-file`, or a pipe into `-`.** Inline
`-s` / `-q` is for short text you are genuinely authoring, not for content that
already exists somewhere.

This matters more when an agent is the caller than it looks:

1. **Inline content must be generated token by token.** Pasting a 50 KB diff
   into `-s` means emitting ~15k output tokens — billed at output rates, slow
   because generation is serial, and a re-transcription of content you already
   have, which invites silent truncation and drift. A path costs ~10 tokens,
   and a pipe keeps the content out of your context window entirely.
2. **The shell rewrites inline content, sometimes by executing it.** In double
   quotes, `` `cmd` `` is command substitution and `${VAR}` expands. Passing
   ``-s "const m = `echo hi`; const p = ${HOME}"`` sends the model
   `const m = hi; const p = /Users/you` — the backtick *ran*. With untrusted
   input (a PR diff, a user log) that is a command-execution surface, not just
   corruption. In single quotes, one apostrophe in the content breaks the
   command outright.

Size is not the deciding factor: ~150 KB passes through the shell fine, and
Jev's own budget binds first. Content safety and token cost are the reasons.

```bash
# Best — content never enters the model context
git diff | jev-cli eval --state-file - --questions-file ./checks.json

# Good — prepare with a command, pass paths
git log -20 --oneline > /tmp/state.txt
jev-cli eval --state-file /tmp/state.txt --questions-file ./checks.json

# Fine — short text you are actually writing
jev-cli eval -s "The agent issued a full refund." -q '{"r":{"type":"boolean","instructions":"Refunded?"}}'

# Wrong — re-transcribing a file you already have, through the shell
jev-cli eval -s "$(cat huge-diff.txt)" -q ...
```

Only one input may read stdin. When both are large, pipe one and pass the other
as a path. Reuse a questions file across calls rather than re-emitting it.

Add `--state-json` when the state is JSON rather than plain text.

## The three question types

Every question needs `instructions`. `instructions` and every criteria
description may be a string, a JSON object, or a JSON array — but never a bare
number or boolean.

| Type | `criteria` | Answer |
| --- | --- | --- |
| `boolean` | Optional `{"true": ..., "false": ...}`, either side omittable | `{"type":"boolean","probability":0.98}` |
| `choice` | **Required.** Object of option name → description (`null` for none) | `{"type":"choice","choice":"warm","probabilities":{...}}` |
| `score` | **Required.** Array of **at least two** levels, lowest first | `{"type":"score","score":1.83,"probabilities":{...}}` |

Three things that trip people up:

- **`boolean` gives P(true), not a boolean.** `0.98` means the model puts 98% on
  *true*. It is not confidence and it is not calibrated — pick your own
  threshold. `0.5` means "equally likely true or false", **not** "medium".
- **`score` is a fractional position** from `0` to `criteria.length - 1` — the
  probability-weighted mean, not an index. Use it, not `boolean`, for gradations.
- **`choice` returns the option name verbatim**, so name options as the values
  your code will switch on. Its probabilities sum to 1, so it picks exactly one
  winner — for "which of these apply, possibly several", use one `boolean` per
  candidate instead.

## Hard limits

- **State and questions share one budget of ~32,000 tokens** (~150,000
  characters of English). Exceeding it fails with
  `{"error_type":"max_tokens_exceeded"}` and HTTP 400.
- **Text only.** State must be a string, JSON object, or array of text. No
  images, audio, or video.

You therefore cannot hand Jev a codebase, a full log archive, or a large
corpus. Pre-build a compact index or excerpt and evaluate that. See
[references/patterns.md](references/patterns.md) for how to structure that.

## Ask everything in one call

Questions are evaluated **in parallel and in isolation** — they never see each
other. Batching is close to free: TypeSafe measures 13 questions in one request
as **11.5x cheaper and 9.6x faster** than 13 separate requests, with identical
answers. Their docs note that coding agents fall into the one-question-per-call
habit more than people do — do not.

Ask everything you might need in a single request and discard what you do not
use. Chain a second request only when you genuinely cannot build it without the
first answer.

## Reading the result

Default output is the bare answers object, keyed by your question ids, so it
pipes straight into `jq`:

```bash
jev-cli eval --state-file - -q "$CHECKS" | jq -e '.deploy_ok.probability > 0.9' >/dev/null && echo healthy
```

Add `--full` for usage, warnings, and `providerMetadata` — where TypeSafe
reports `confidence` for choice and score answers, which is separate from the
probabilities. On the `jev` provider it lands at
`providerMetadata.jev.answers.<id>.confidence`. Add `--compact` for single-line
JSON.

## Exit codes and errors

`eval` writes errors to **stderr** as JSON (`{"error":{"code","message"}}`),
keeping stdout clean. Always branch on the exit code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Success | Parse stdout |
| `1` | Provider or network failure | Retry once; report if it persists |
| `2` | Bad usage or invalid questions | Fix the JSON — the message names the offending question id and field |
| `3` | Missing or rejected credentials | Relay the message to the user; do not retry. See below |

A code `2` message like `questions.quality.criteria must list at least two
ordered levels, but got 1` points at the exact path to fix.

### Diagnosing a failure

Only when a call actually fails, and only for codes `1` and `3`:

```bash
jev-cli doctor --offline   # config, provider, model, key source — no network call
jev-cli doctor             # the above, plus one tiny live evaluation
```

Code `3` carries the provider's own words, and they distinguish cases that need
different fixes — a missing key, a revoked key, an account without billing set
up, or a model the plan cannot reach all read differently. Relay that message
rather than assuming the key is wrong, and never invent a key. If one is
genuinely missing, the user supplies it:

```bash
jev-cli config set providers.<provider>.apiKey <key>
```

Run `jev-cli doctor --offline` first to see which provider is active; the key
belongs under that provider's name (`jev` or `vercel`).

Never print a key back — `config list` masks them unless `--show-secrets` is
passed.

## Configuration reference

Config lives at `~/.jev-cli/config.yaml` (override the directory with
`JEV_CLI_HOME`), written `0600`.

```bash
jev-cli config path                    # where the file is
jev-cli config list                    # every value, keys masked
jev-cli config get providers.jev.model
jev-cli config set providers.jev.model jev-latest
jev-cli config unset providers.jev.baseURL
```

Two providers reach the same model:

| `provider` | Default model | Environment fallback |
| --- | --- | --- |
| `jev` | `jev-latest` | `JEV_CLI_API_KEY`, `TYPESAFE_API_KEY`, `TYPESAFE_AI_API_KEY` |
| `vercel` *(default)* | `typesafe-ai/jev` | `JEV_CLI_API_KEY`, `AI_GATEWAY_API_KEY` |

Precedence is **CLI flag > environment > config file**. In CI, set
`JEV_CLI_API_KEY` and skip the config file entirely. `--provider` and `--model`
override the file for a single call.

## Going further

- **[references/question-design.md](references/question-design.md)** — how to
  word questions and structure state so the answers are usable: atomic
  questions, splitting composite judgments, single- vs multi-label, choosing
  between the three types.
- **[references/patterns.md](references/patterns.md)** — architectures for
  bigger problems: speculative fan-out, two-stage shortlisting, hierarchical
  classification over taxonomies and codebases, confidence-gated routing.

Official docs index (agent-readable): https://docs.typesafe.ai/llms.txt
