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
