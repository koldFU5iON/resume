# Weekly releases

A scheduled GitHub Action opens one release PR with a changelog entry and a version bump. It never merges or publishes. Merging the PR is the release.

Files: `.github/workflows/weekly-release.yml` (schedule and dispatch), `scripts/release.mjs` (logic, no dependencies), `scripts/release.test.mjs` (tests), `CHANGELOG.md` (output and state).

## Where the version shows

`package.json` is the single source of truth. `src/lib/version.ts` re-exports it as `APP_VERSION`, which the dashboard footer (`vX.Y.Z`, linking to `/dashboard/changelog`), the changelog page header and the MCP server info all use. Merging a release PR changes it everywhere on the next deploy. `/dashboard/changelog` renders `CHANGELOG.md` and shows an empty state until the first release exists.

## Schedule

- Every Monday 06:00 UTC, or run manually: Actions → Weekly release → Run workflow.
- Concurrent runs are serialized.

## What a run does

1. Reads the cursor `<!-- release-cursor: … -->` in `CHANGELOG.md`.
2. Lists closed PRs targeting the default branch (paginated, newest-updated first, stopping once it passes the cursor). It keeps PRs merged at or after the cursor, skipping the release PR (head branch `release/weekly`) and any PR number already in `CHANGELOG.md`.
3. No new PRs: nothing changes, no PR is touched.
4. New PRs: the bump is the highest label among them, the version is written to `package.json` and `package-lock.json`, a new section goes at the top of `CHANGELOG.md`, and the cursor moves to the newest merged PR included.
5. Commits to `release/weekly` (force-pushed) and opens the PR, or updates the title and body of the open one.

Reruns are safe. The branch is rebuilt from `main`, so a rerun gives the same result, or picks up new labels or merged PRs. A release PR that is not yet merged does not move the cursor on `main`.

## First-run baseline

There is no changelog yet. The first run only records the cursor (the commit that introduced the workflow) and opens a PR titled "Start weekly release changelog". PRs merged before that baseline are never released. Merge that PR to start the schedule. PRs merged at or after the baseline are picked up by the next run. The baseline stays fixed across retries while its PR awaits merge. Existing changelogs without a cursor fail rather than being overwritten.

## Version policy (SemVer)

Labels on each merged PR:

| Label   | Bump                    |
|---------|-------------------------|
| `major` | X+1.0.0                 |
| `minor` | X.Y+1.0                 |
| `patch` | X.Y.Z+1 (also default)  |

The release bump is the highest among included PRs. A PR with no bump label counts as `patch`. To change a bump, relabel the PR and run the workflow manually; the open release PR is updated in place.

Labels must exist in the repo. Create `major`, `minor` and `patch` in the GitHub label settings if they do not.

## Permissions and setup

- Repo Settings → Actions → General → Workflow permissions: enable "Allow GitHub Actions to create and approve pull requests". Without it, `gh pr create` fails with a permissions error.
- The workflow uses only the built-in `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`). No secrets, no paid API.
- Limitation: PRs opened or pushed with `GITHUB_TOKEN` do not trigger other workflows, so CI (`ci.yml`) will not run on the release PR. Close and reopen the PR as a user to trigger CI (the existing CI workflow has no manual dispatch). Using a GitHub App or PAT token would fix this, but needs a secret.

## Dry run

```bash
RELEASE_BASE_BRANCH=main GITHUB_REPOSITORY=koldFU5iON/resume GITHUB_TOKEN=<token with repo read> node scripts/release.mjs --dry-run
```

It prints the release it would make and writes no files. Tests: `npx vitest run scripts/release.test.mjs`.

## Known limits

- The cursor includes its boundary second; recorded PR numbers prevent duplicates, including when multiple PRs merge in the same second.
- The changelog is generated from PR titles only.
- More than 2000 closed PRs since the cursor makes the script fail rather than truncate. Release by hand then.
