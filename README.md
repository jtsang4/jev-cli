# jev-cli

> English | [简体中文](./README_CN.md)

A command-line interface for **[Jev](https://vercel.com/ai-gateway/models/jev)**, TypeSafe AI's evaluation model. Give it a state and some typed questions; get structured JSON back.

Jev is a "System One" model: instead of generating prose, it judges shared state against typed questions and returns choices, scores, and probabilities your code can branch on. That makes it a good fit for classification, routing, rubric scoring, and automated verification — and a poor fit for writing text, which it cannot do.

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

## Install

```bash
bun install -g @jtsang/jev-cli   # or: npm install -g @jtsang/jev-cli
```

The published binary runs on Node 22+ or Bun.

## Set up

Get an API key from the [Vercel AI Gateway dashboard](https://vercel.com/dashboard/ai-gateway), then:

```bash
jev-cli config init
jev-cli config set providers.vercel.apiKey <your-key>
jev-cli doctor
```

`doctor` sends one tiny evaluation to confirm the key and model actually work. Use `--offline` to check the configuration without a network call.

## Usage

```
jev-cli eval  -s, --state <text>          -q, --questions <json>
              --state-file <path>            --questions-file <path>
              --state-json                   parse the state as JSON
              --provider <name>  --model <id>  --timeout <ms>
              --full     include usage, warnings, and provider metadata
              --compact  emit single-line JSON

jev-cli config init | path | list | get <key> | set <key> <value> | unset <key>
jev-cli doctor [--offline]
```

Both inputs accept `-` to read from stdin, though only one may do so per invocation:

```bash
git diff | jev-cli eval --state-file - --questions-file ./checks.json
```

## Question types

Every question needs `instructions`. Instructions and criteria descriptions may each be a string, a JSON object, or a JSON array.

| Type | `criteria` | Answer shape |
| --- | --- | --- |
| `boolean` | Optional `{"true": …, "false": …}` | `{"type":"boolean","probability":0.98}` — **P(true)**, uncalibrated |
| `choice` | **Required.** Option name → description (or `null`) | `{"type":"choice","choice":"warm","probabilities":{…}}` |
| `score` | **Required.** Array of **≥2** levels, lowest first | `{"type":"score","score":1.83,"probabilities":{…}}` |

A `score` is a fractional position in `[0, levels-1]` — the probability-weighted mean, not an index. Confidence for `choice` and `score` answers is reported separately under `providerMetadata.typesafe.confidence` when you pass `--full`.

Questions are evaluated in parallel and in isolation against the same state, so adding questions costs almost nothing — but each one must stand on its own. Keep them atomic and combine the results in your own code.

## Configuration

`~/.jev-cli/config.yaml`, written with `0600` permissions. Override the directory with `JEV_CLI_HOME`.

```yaml
provider: vercel
providers:
  vercel:
    apiKey: "vck_..."
    model: typesafe-ai/jev
    # baseURL: https://ai-gateway.vercel.sh/v4/ai
```

Precedence is **CLI flag > environment > config file**. The environment variables are `JEV_CLI_API_KEY`, then `AI_GATEWAY_API_KEY` — handy in CI, where you can skip the config file entirely.

`provider` currently accepts only `vercel`. The value `jev` is reserved for TypeSafe's official API and is rejected until it is implemented.

Keys are masked in `config list` output unless you pass `--show-secrets`.

## Exit codes

`eval` prints errors to stderr as JSON, leaving stdout for results alone.

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Provider or network failure |
| `2` | Bad usage or invalid questions |
| `3` | Missing or rejected credentials |

## Agent skill

This package ships [`skills/use-jev-cli`](./skills/use-jev-cli/SKILL.md), a skill that teaches coding agents when and how to use `jev-cli`.

## Development

```bash
bun install
bun test            # unit + CLI end-to-end tests
bun run typecheck
bun run build       # bundles to dist/cli.js for Node
bun link            # install the local build as a global jev-cli
```

Releases are documented in [RELEASING.md](./RELEASING.md).

## License

MIT
