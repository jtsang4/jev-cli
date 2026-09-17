---
name: use-jev-cli
description: Evaluate text or structured state against typed questions using jev-cli, which calls TypeSafe AI's Jev model for fast structured decisions — classification, routing, rubric scoring, and automated verification — returning JSON answers instead of prose. Use when you need a machine-readable verdict (a category, a 0-1 truth probability, or a rubric score) rather than generated text, or when checking many independent properties of the same content at once. Not for generating, summarizing, or rewriting text.
compatibility: Requires the jev-cli binary on PATH and a configured provider API key.
metadata:
  requires:
    bins: ["jev-cli"]
---

# Using jev-cli

`jev-cli` asks **Jev**, a "System One" evaluation model, to judge one shared **state** against a set of typed **questions**. It returns structured JSON — a choice, a score, or a probability — never prose.

Reach for it when you need a decision your code can branch on. It is far faster and cheaper than a full LLM call (Jev is priced per input token with zero output tokens), so checking ten properties of a diff, a log, or a support transcript is cheap.

Do **not** use it to write, summarize, translate, or rewrite anything. It cannot produce text.

## Check the setup first

```bash
jev-cli doctor --offline      # configuration only, no network call
jev-cli doctor                # also verifies the credentials with one tiny request
```

If it reports a missing key, the user must supply one:

```bash
jev-cli config set providers.vercel.apiKey <ai-gateway-key>
```

Never invent a key, and never print one back to the user — `config list` masks keys unless `--show-secrets` is passed.

## Running an evaluation

```bash
jev-cli eval --state <text> --questions <json>
```

`-s` and `-q` are the short forms. Either input accepts `-` to read stdin (only one of them may), and each has a `--state-file` / `--questions-file` variant. Add `--state-json` when the state is JSON rather than plain text.

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
  "refunded": { "type": "boolean", "probability": 0.98 },
  "tone": { "type": "choice", "choice": "warm", "probabilities": { "warm": 0.94, "curt": 0.06 } },
  "quality": { "type": "score", "score": 1.83, "probabilities": { "0": 0.01, "1": 0.15, "2": 0.84 } }
}
```

For long or quote-heavy content, pass files instead of inline strings:

```bash
git diff | jev-cli eval --state-file - --questions-file ./checks.json
```

## The three question types

Every question needs `instructions`. `instructions` and every criteria description may be a string, a JSON object, or a JSON array — but never a bare number or boolean.

| Type | `criteria` | Answer |
| --- | --- | --- |
| `boolean` | Optional `{"true": ..., "false": ...}`, either side omittable | `{"type":"boolean","probability":0.98}` |
| `choice` | **Required.** Object of option name → description (`null` for none) | `{"type":"choice","choice":"warm","probabilities":{...}}` |
| `score` | **Required.** Array of **at least two** levels, lowest first | `{"type":"score","score":1.83,"probabilities":{...}}` |

Three things that trip people up:

- **`boolean` gives P(true), not a boolean.** `probability: 0.98` means the model puts 98% on *true*. It is not a confidence score, and it is not calibrated — pick your own threshold.
- **`score` is a fractional position**, from `0` to `criteria.length - 1`. With three levels, `1.83` sits most of the way to the top level. It is the probability-weighted mean, not an index.
- **`choice` returns the option name verbatim**, so name options as the values your code will switch on.

## Writing good questions

Questions are evaluated **in parallel and in isolation** against the same state — they never see each other. Two consequences:

1. **Adding questions is nearly free.** Ask everything you need in one call rather than making several.
2. **Each question must stand alone.** Keep every one atomic, the kind of gut-check a well-informed person makes in seconds.

When a judgment needs several independent factors weighed together, split it into separate questions and combine them in your own code. Instead of one "is this pitch fundable?" score, ask about market size, technical feasibility, and differentiation separately, then apply your own formula — reweighting becomes editing a coefficient instead of rewriting a prompt.

## Reading the result

Default output is the bare answers object, keyed by your question ids, so it pipes straight into `jq`:

```bash
jev-cli eval -s "$LOG" -q "$CHECKS" | jq -e '.deploy_ok.probability > 0.9' >/dev/null && echo "healthy"
```

Add `--full` for usage, warnings, and `providerMetadata` — which is where TypeSafe reports `confidence` for choice and score answers. Add `--compact` for single-line JSON.

## Exit codes and errors

`eval` writes errors to **stderr** as JSON (`{"error":{"code","message"}}`), keeping stdout clean for results. Always branch on the exit code:

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Success | Parse stdout |
| `1` | Provider or network failure | Retry once; report if it persists |
| `2` | Bad usage or invalid questions | Fix the question JSON — the message names the offending question id and field |
| `3` | Missing or rejected credentials | Ask the user to set the API key; do not retry |

A code `2` message like `questions.quality.criteria must list at least two ordered levels, but got 1` points at the exact path to fix.

## Configuration reference

Config lives at `~/.jev-cli/config.yaml` (override the directory with `JEV_CLI_HOME`), written `0600`.

```bash
jev-cli config path                       # where the file is
jev-cli config list                       # every value, keys masked
jev-cli config get providers.vercel.model
jev-cli config set providers.vercel.model typesafe-ai/jev
jev-cli config unset providers.vercel.baseURL
```

Precedence is **CLI flag > environment (`JEV_CLI_API_KEY`, then `AI_GATEWAY_API_KEY`) > config file**. In CI, set `JEV_CLI_API_KEY` and skip the config file entirely.

`provider` currently accepts only `vercel` (Vercel AI Gateway). The value `jev` is reserved for TypeSafe's official API and is rejected until implemented.
