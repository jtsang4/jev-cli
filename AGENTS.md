# AGENTS.md

## Project

This repository publishes `@jtsang/jev-cli`, a command-line interface for
TypeSafe AI's Jev evaluation model. The CLI takes one shared state plus typed
questions and prints structured JSON answers. It never generates prose.

## Toolchain

- Bun is the development toolchain: `bun install`, `bun test`, `bun run build`.
- Do not create npm or Yarn lockfiles; `bun.lock` is the only lockfile.
- The published binary targets Node 22+, built by `bun build --target=node`.
  Keep it runnable under plain Node — `verify.yml` asserts this.
- `bun publish` has no trusted-publishing support, so CI publishes with the npm
  CLI. Do not switch the publish step to Bun.

## Layout

- `src/cli.ts`: entry point, argument dispatch, exit-code mapping.
- `src/commands/<name>.ts`: one file per subcommand, each parsing its own flags.
- `src/config/`: config file paths, schema, and the yaml-Document-backed store.
- `src/providers/`: provider resolution and evaluation-model construction.
- `src/questions.ts`: the validation boundary between untyped JSON and the SDK.
- `skills/use-jev-cli/SKILL.md`: how coding agents should drive the CLI. Ships
  in the published package.
- `.agents/skills/<name>/SKILL.md`: repository-maintenance skills, not
  published. `.claude/skills/<name>` symlinks to them so both agent runtimes
  see the same file — add a matching symlink whenever you add a skill.

## Reference documentation

Fetch these `llms.txt` indexes rather than guessing at APIs or crawling docs
sites — each is an agent-readable table of contents linking `.md` versions of
every page.

| Source | URL | Use it for |
| --- | --- | --- |
| TypeSafe AI (Jev) | https://docs.typesafe.ai/llms.txt | The evaluate contract itself: question primitives (choice/score/noul), state design, patterns (fan-out, composite scoring, hierarchical classification), cookbooks, model jaggedness |
| AI SDK | https://ai-sdk.dev/llms.txt | `experimental_evaluate`, provider interfaces, evaluation model spec |
| Vercel AI Gateway | https://vercel.com/docs/llms.txt | Gateway routing, authentication, pricing and free-vs-paid credit tiers, rate limits |
| Bun | https://bun.com/llms.txt | Build flags, `bun test`, `Bun.YAML`, `bun link`, lockfile behavior |

Two things worth knowing before designing anything around Jev, both from the
TypeSafe docs and both easy to get wrong:

- **State and questions share one budget of ~32,000 tokens (~150,000
  characters), and Jev accepts text only.** You cannot hand it a codebase; you
  hand it a pre-built index and keep the material small.
- **Questions must be atomic.** A judgment that needs several factors weighed
  together should be several questions combined by your own code. Batching is
  nearly free — the docs measure 13 questions in one call as 11.5x cheaper and
  9.6x faster than 13 calls, with identical answers.

npm's own docs have no `llms.txt`; use https://docs.npmjs.com/trusted-publishers
directly for release-path questions.

## Conventions

- Question and answer types come from `@ai-sdk/provider`
  (`Experimental_EvaluationModelV4*`). Do not redeclare them locally; the SDK
  is the source of truth for the evaluate contract.
- Validate every question field before calling the provider, and name the
  offending question id and field in the error message.
- Exit codes are a public contract: `0` success, `1` runtime, `2` usage or
  validation, `3` config or credentials. Add new failures to an existing code
  rather than inventing one.
- `eval` writes errors to stderr as JSON; human-facing commands write plain
  sentences. stdout carries results only.
- Never log an API key. Secrets are masked unless `--show-secrets` is passed,
  and the config file is written `0600` inside a `0700` directory.
- Config values are stored as strings; there is no type coercion in
  `config set`.
- Tests set `JEV_CLI_HOME` to a temp directory so they never touch the real
  config.

## Verification

```sh
bun test            # unit + CLI end-to-end
bun run typecheck
bun run build
npm pack --dry-run  # inspect the publish tarball
```

Run `bun run verify` before committing. Update both `README.md` and
`README_CN.md` when user-facing behavior changes; they are kept in sync.

## Commits

All commit messages must be written in English and follow Conventional Commits.
Use an optional scope when it adds useful context.

```text
feat(config): add dotted-path config set
fix(questions): reject score criteria with one level
chore: initialize package
```
