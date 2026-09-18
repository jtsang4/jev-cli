---
name: release
description: Release the @jtsang/jev-cli npm package from this repository. Use when the user asks to cut a release, publish to npm, tag a version, release major/minor/patch, or ship a specific version. Covers committing local work, syncing with origin/main, choosing the version, pushing the release tag, tracking the GitHub Actions trusted-publishing run, and confirming the result on the registry. When no version is given, gather current state first and ask the user to choose major, minor, or patch.
compatibility: Requires Git, Bun, Node.js 22+, an authenticated GitHub CLI with push access to jtsang4/jev-cli, and network access to GitHub and the public npm registry.
---

# Release

Ship a verifiable npm release of `@jtsang/jev-cli` from a local workspace. This
skill is specific to `jtsang4/jev-cli`: release branch `main`, workflow
`.github/workflows/publish.yml`, tag format `v<package.json version>`.

A request to release authorizes the commits, merges, version bump, and pushes
needed to do it. Act directly when the version or bump type is given; ask only
when the version is unspecified, the choice has gone stale, or a merge conflict
hides a product decision. If the user only asks how releasing works, or asks
for a rehearsal, explain or dry-run instead of publishing.

**Publishing happens in CI via OIDC trusted publishing.** Never run
`npm publish` locally and never introduce a long-lived npm token. The trusted
publisher is already configured on npmjs.com for `jtsang4/jev-cli` +
`publish.yml` with `npm publish` permitted.

## 1. Save local work

Read `AGENTS.md`, `package.json`, and the publish workflow. Then inspect:

```sh
git status --short --branch
git branch --show-current
git remote -v
git diff
git diff --cached
git ls-files --others --exclude-standard
gh repo view --json nameWithOwner,defaultBranchRef
```

Confirm you are in `jtsang4/jev-cli`. Record the user's `major`, `minor`,
`patch`, or exact version (accept `v0.2.0`; store `0.2.0` in package.json).
Check for an in-progress merge or rebase and resolve it before continuing —
never discard the user's work.

With changes present, review every pending file including untracked ones, get
`bun run verify` and `git diff --check` passing, then `git add -A`, review
`git diff --cached`, and commit using an English Conventional Commit. Split
independent topics into separate commits, but never commit the version bump
while leaving other code behind. Skip this step entirely when the tree is
clean; do not create empty commits and do not stash instead of committing.

## 2. Sync with origin/main

Always sync and re-query npm, even when the user named a version, so a release
never goes out from stale state. Record the current branch and HEAD, then:

```sh
git fetch origin --prune --tags
```

If the current feature branch also exists on origin, merge that in first and
re-record its HEAD afterwards. Then switch to local `main` (creating it to
track `origin/main` if absent), merge the latest `origin/main`, and merge the
recorded feature HEAD into `main`. When already on `main`, merging
`origin/main` is enough. Integrate with `git merge --no-commit`: fast-forwards
add no commit, while diverged histories need review and a passing
`bun run verify` before you create the merge commit. Never force-push, never
`reset --hard`, and never rewrite pushed history to remove divergence.

Resolve conflicts yourself when the code and the user's intent make the answer
clear, keeping both sides' valid changes. Ask only about genuine product
trade-offs. For dependency conflicts, fix `package.json` first and regenerate
the lockfile with Bun — never hand-edit `bun.lock`.

Then run `bun install --frozen-lockfile` and re-read the merged version and
workflow. If the install fails, fix the real dependency or lockfile problem
rather than bypassing the frozen check.

## 3. Decide the version

```sh
npm view @jtsang/jev-cli dist-tags versions --json --registry=https://registry.npmjs.org
git tag --list 'v*'
git log --oneline -10
```

Record npm's `latest`, every published version, the synced package.json
version, and what is pending release. If the query fails, retry or resolve the
network/permission error — never treat a failure as "not published yet".
Compare versions numerically per SemVer, not as strings; `latest` can lag
behind the highest stable version.

- **Exact version**: use it as given. If package.json already equals it, do not
  bump again.
- **major/minor/patch**: bump from whichever is higher — npm's highest
  published stable version, or the synced local stable version. `A.B.C` gives
  `A+1.0.0`, `A.B+1.0`, `A.B.C+1`. If the local version is already ahead, state
  the base and target rather than silently using the older npm base.
- **Unspecified**: finish the commit, sync, and query first, then show the
  current npm and local versions alongside three concrete options —
  `major → …`, `minor → …`, `patch → …` — and let the user choose. Recommend
  one based on the changes, but never choose for them, and never bump the
  version or push a tag before they answer.

Handle stable versions by default. Parse any prerelease with full SemVer and
state its relation to the stable base; do not strip a prerelease suffix and
infer a bump from it. A stable target must be at least the synced local stable
version and strictly above npm's highest published stable version. If the
target already exists, jump to section 6 to verify it instead of republishing,
overwriting, or moving `latest` backwards.

If the user picks a version that goes stale while you wait, refresh the three
candidates and reconfirm. If they authorized a bump type instead, recompute it
from the new base and say so. Record the pre-bump base, the target, and the
remote commit and npm version you saw, for the pre-push recheck.

## 4. Bump and verify

Only when the target differs from package.json:

```sh
npm version "$release_version" --no-git-tag-version
```

That flag keeps npm from committing or tagging. Review what it changed; do not
create npm or Yarn lockfiles and do not hand-edit `bun.lock`.

Run the full gate:

```sh
bun run verify        # bun test, tsc --noEmit, bun build
git diff --check
node dist/cli.js --version
```

The built binary must run on plain Node, not just Bun — `verify.yml` asserts
this and a release that breaks it ships a package most users cannot run.

When CLI behavior changed, also exercise it for real before tagging:

```sh
jev-cli doctor        # live credential + model check
```

Re-run affected checks after any fix. Then commit the version and any needed
fixes as `chore(release): prepare <version>`, or commit independently
meaningful fixes separately. Skip the commit if the version was already
committed and nothing else changed. Never create a release tag while any check
is failing.

## 5. Push main and exactly one release tag

Fetch and re-query npm once more before pushing. If `origin/main` moved ahead,
merge, re-read the version, and re-verify; if an external version change makes
the target invalid, return to section 3. A version you wrote yourself is not an
external change — never bump it again on that basis. Record the release HEAD:

```sh
git push --no-follow-tags origin HEAD:refs/heads/main
```

If the push is rejected because the remote moved, re-sync, re-verify, and push
again — never force-push. Confirm remote `main` contains the release HEAD and
package.json equals the target, then check whether `v<version>` already exists
locally or remotely. Resolve annotated tags with
`git rev-parse 'v<version>^{commit}'` when comparing.

- Absent: create the annotated tag and push only that tag.
- Exists and points at this release HEAD: reuse it; push it if it is local only.
- Points at a different commit: leave it alone. Determine whether it is an
  existing release, a failed retry, or a version conflict. Never move, delete,
  or force-push a released tag — pick a new version for new code.

```sh
git tag -a "v$release_version" -m "Release $release_version"
git push origin "refs/tags/v$release_version:refs/tags/v$release_version"
```

Pushing the tag triggers the workflow, which publishes over OIDC. The workflow
refuses to run unless the tag is exactly `v<package.json version>` and the
commit is an ancestor of `origin/main`. Stable versions go to `latest`;
prereleases (any version containing `-`) go to `next`. Creating a tag locally
without pushing it triggers nothing.

## 6. Track the run and verify npm

```sh
gh run list --repo jtsang4/jev-cli --workflow publish.yml --event push --commit "$release_sha" --limit 20 --json databaseId,headSha,headBranch,status,conclusion,url
gh run watch "$run_id" --repo jtsang4/jev-cli --exit-status
```

Substitute the recorded release HEAD for `$release_sha` and pick the run whose
headSha and tag both match. Record the run ID and URL. Wait briefly and re-query
if the run has not been queued yet. A timeout on the watch command does not mean
the workflow failed — keep tracking the same run ID rather than triggering a
second release.

On success, read the log to confirm a real publish rather than a dry run, then:

```sh
npm view "@jtsang/jev-cli@$release_version" version gitHead dist.tarball dist.integrity --json --registry=https://registry.npmjs.org
npm view @jtsang/jev-cli dist-tags --json --registry=https://registry.npmjs.org
```

Confirm the exact version exists and the intended dist-tag points at it, and
reconcile the registry `gitHead` (or provenance source commit) with the release
HEAD. If a higher version was published concurrently, do not move `latest` back.

**Registry reads lag behind writes, and every read endpoint can lag.** For up
to a few minutes after a successful publish, `npm view` may report `E404`, the
packument may return `{"error":"Not found"}`, and the version-specific endpoint
`https://registry.npmjs.org/@jtsang%2Fjev-cli/<version>` may return
`"version not found: <version>"` — all at once, with nothing wrong. Do not
treat any single read as authoritative proof of failure, and do not rerun the
workflow or bump the version on a 404 alone.

Proof that the publish happened lives in the run log, not the registry: the
`Verify and publish package` step prints `Publishing to
https://registry.npmjs.org/ with tag <dist-tag>` followed by a provenance
statement and its transparency-log URL. Once you have seen those lines with
`DRY_RUN: false`, the release is out; the only open question is when it becomes
visible. Poll with bounded retry (roughly every 10s for a couple of minutes)
until `npm view "@jtsang/jev-cli@<version>" version` answers, then continue the
checks below. `npm access list packages @jtsang` is a useful cross-check when
even that stalls. Never claim npm publication on a successful tag push alone —
the tag push only starts the workflow.

Finally, confirm the artifact actually installs and runs:

```sh
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install "@jtsang/jev-cli@$release_version"
./node_modules/.bin/jev-cli --version
```

On failure, read `gh run view "$run_id" --log-failed` and query the exact npm
version to determine whether it published anyway. For a transient failure on
the same commit with the version still absent, `gh run rerun` the run, or run
`publish.yml` manually against the **existing tag** with `dry_run=false`. When
a code change is needed, commit the fix and retry under a new version and tag —
never move an already-pushed tag. Treat an existing version as recovered only
after verifying its provenance, not because the version number matches.

An `ENEEDAUTH` or 403 in the publish step usually means the trusted publisher
configuration no longer matches: check org `jtsang4`, repository `jev-cli`,
workflow filename `publish.yml`, and that `npm publish` is an allowed action at
https://www.npmjs.com/package/@jtsang/jev-cli/access. All fields are
case-sensitive and npm does not validate them at save time.

Report the npm version, Git tag and commit, the Actions run URL, the npm
package URL, and whether the local tree is clean and pushed. If blocked, say
exactly which step stopped and what state has already landed.
