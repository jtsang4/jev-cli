# jev-cli

> English | [简体中文](./README_CN.md)

A command-line interface for **[Jev](https://docs.typesafe.ai)**, TypeSafe AI's evaluation model. Give it a state and some typed questions; get structured JSON back.

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

Get a key from the [TypeSafe AI dashboard](https://console.typesafe.ai/keys), then:

```bash
jev-cli config init
jev-cli config set providers.jev.apiKey <your-key>
jev-cli doctor
```

The default provider is `jev`, which calls TypeSafe AI's API directly. If you would rather route through the [Vercel AI Gateway](https://vercel.com/dashboard/ai-gateway), switch to it:

```bash
jev-cli config set provider vercel
jev-cli config set providers.vercel.apiKey <your-gateway-key>
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
jev-cli doctor [--offline] [--provider <name>] [--model <id>]
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

A `score` is a fractional position in `[0, levels-1]` — the probability-weighted mean, not an index. Confidence for `choice` and `score` answers is reported under `providerMetadata` when you pass `--full`: at `jev.answers.<id>.confidence` on the `jev` provider, and at `typesafe.confidence` through the gateway.

Questions are evaluated in parallel and in isolation against the same state, so adding questions costs almost nothing — but each one must stand on its own. Keep them atomic and combine the results in your own code.

## Configuration

`~/.jev-cli/config.yaml`, written with `0600` permissions. Override the directory with `JEV_CLI_HOME`.

```yaml
provider: jev
providers:
  jev:
    apiKey: "..."
    model: jev-latest
    # baseURL: https://api.typesafe.ai/v1
  vercel:
    apiKey: "vck_..."
    model: typesafe-ai/jev
    # baseURL: https://ai-gateway.vercel.sh/v4/ai
```

Only the active provider's settings are read, so both can live in the file at once.

| `provider` | Default model | Key from | Environment fallback |
| --- | --- | --- | --- |
| `jev` *(default)* | `jev-latest` | [TypeSafe AI](https://console.typesafe.ai/keys) | `JEV_CLI_API_KEY`, `TYPESAFE_API_KEY`, `TYPESAFE_AI_API_KEY` |
| `vercel` | `typesafe-ai/jev` | [Vercel AI Gateway](https://vercel.com/dashboard/ai-gateway) | `JEV_CLI_API_KEY`, `AI_GATEWAY_API_KEY` |

Precedence is **CLI flag > environment > config file** — handy in CI, where you can skip the config file entirely.

Switch with `jev-cli config set provider <name>`, or per call with `--provider <name>`. Note that `JEV_CLI_API_KEY` applies to whichever provider is active: if you keep both configured, set the provider-specific variables instead, or the same key gets sent to both.

On the `jev` provider, `model` takes `jev-latest`, `jev-preview`, or a pinned release such as `jev-1.13.0`. Pin the version once you have calibrated confidence thresholds, since the aliases move when a release ships.

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
