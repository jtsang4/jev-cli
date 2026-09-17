# Releasing

`@jtsang/jev-cli` publishes to npm through **trusted publishing** (OIDC). Routine releases need no npm token anywhere — not on your machine, not in repository secrets.

## One-time bootstrap

Trusted publishing is configured on an existing package's settings page, so the first version has to go out with a credential.

1. `npm login`
2. `npm publish --access public`
3. On npmjs.com, open **Packages → @jtsang/jev-cli → Settings → Trusted Publisher** and add a GitHub Actions publisher:

   | Field | Value |
   | --- | --- |
   | Organization or user | `jtsang4` |
   | Repository | `jev-cli` |
   | Workflow filename | `publish.yml` |
   | Environment | *(leave empty)* |

   npm does not validate these when you save them; a typo surfaces later as `ENEEDAUTH`. Every field is case-sensitive.
4. Confirm the trust works without publishing anything:

   ```bash
   gh workflow run publish.yml -f dry_run=true
   ```

   The `Verify npm trusted publisher` step performs a real OIDC token exchange and prints a confirmation. The credential stays in memory and is never logged.

Once this succeeds you can revoke any local npm token — it is no longer part of the release path.

## Cutting a release

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
