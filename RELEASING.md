# Releasing

`@jtsang/jev-cli` publishes to npm through **trusted publishing** (OIDC). Routine releases need no npm token anywhere — not on your machine, not in repository secrets.

## Bootstrap status: done

Trusted publishing is **already configured** and verified. You should never
need to repeat this, but here is what was done and why.

npm cannot publish a package's first version over OIDC — the trusted-publisher
setting only appears once the package exists ([npm/cli#8544][oidc-issue]). So
`0.1.0` went out with an authenticated `npm publish`, and the publisher was
configured immediately afterwards:

| Field | Value |
| --- | --- |
| Organization or user | `jtsang4` |
| Repository | `jev-cli` |
| Workflow filename | `publish.yml` |
| Environment | *(empty)* |
| Allowed actions | `npm publish` **and** `npm stage publish` |

`npm publish` must stay allowed: the workflow calls it directly, so leaving
only `npm stage publish` enabled would break every release.

Verified with `gh workflow run publish.yml -f dry_run=true`, where the
`Verify npm trusted publisher` step reported:

> npm accepted this workflow's OIDC identity for @jtsang/jev-cli. No package
> was published by this check.

No npm token is part of the release path. Review the configuration at
https://www.npmjs.com/package/@jtsang/jev-cli/access.

> **Do not use `npm trust github` to reconfigure this.** On npm 11.12.1 it is
> broken: it POSTs a bare object where the registry expects an array, so it
> fails with a bare `400 Bad Request`. Use the web UI instead.

[oidc-issue]: https://github.com/npm/cli/issues/8544

## Cutting a release

Ask an agent to run the [`release` skill](.agents/skills/release/SKILL.md),
which automates the whole flow. Manually, it is:

```bash
bun run verify                  # tests, typecheck, build
npm version <patch|minor|major> # commits and tags v<version>
git push --follow-tags
```

Pushing the tag triggers `.github/workflows/publish.yml`, which:

- refuses to run unless the tag is exactly `v<version from package.json>` and the commit is an ancestor of `origin/main`;
- routes prerelease versions (any version containing `-`) to the `next` dist-tag and everything else to `latest`;
- runs `prepublishOnly` → `bun run verify` before publishing;
- publishes with the npm CLI, since `bun publish` has no trusted-publishing support.

A `workflow_dispatch` dry run re-verifies the OIDC trust and the tarball
without publishing. When the current version is already on the registry it
validates with `npm pack` instead, since a publish dry run would fail on the
version check alone and tell you nothing.

## Checks before tagging

```bash
bun run verify
npm pack --dry-run    # inspect exactly what ships
node dist/cli.js --version
```

The tarball should contain `dist/`, `skills/`, both READMEs, and `LICENSE` — nothing else.

## If publishing fails

| Symptom | Cause |
| --- | --- |
| `ENEEDAUTH` / `401` in the publish step | Trusted publisher fields do not match the repo or workflow filename exactly |
| `Publish requires refs/tags/vX.Y.Z` | The tag and `package.json` version disagree — retag |
| `git merge-base --is-ancestor` fails | The tagged commit is not on `main` |
| Missing `id-token` | The `permissions:` block in `publish.yml` was edited |
