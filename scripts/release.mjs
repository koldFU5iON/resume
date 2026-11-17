#!/usr/bin/env node
// Weekly release: collects PRs merged since the last release cursor, picks a SemVer bump
// from PR labels, and rewrites CHANGELOG.md, package.json and package-lock.json.
// No dependencies. Needs GITHUB_TOKEN and GITHUB_REPOSITORY (both set by GitHub Actions).
// Usage: node scripts/release.mjs [--dry-run]
import { readFile, writeFile, appendFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

export const RELEASE_BRANCH = "release/weekly"
const CHANGELOG = "CHANGELOG.md"
const CURSOR_RE = /<!-- release-cursor: (\S+) -->/
const HEADER = "# Changelog\n\nNewest first. Generated weekly from merged pull requests by `scripts/release.mjs`.\n"
const BUMP_ORDER = ["patch", "minor", "major"]

/** Bump level for one PR. Labels `major` / `minor` / `patch` are explicit; anything else is a patch. */
export function bumpFor(labels) {
  const names = labels.map((label) => label.name.toLowerCase())
  return BUMP_ORDER.findLast((bump) => names.includes(bump)) ?? "patch"
}

export function maxBump(bumps) {
  return bumps.reduce((a, b) => (BUMP_ORDER.indexOf(b) > BUMP_ORDER.indexOf(a) ? b : a), "patch")
}

export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`Unsupported version "${current}"; expected MAJOR.MINOR.PATCH`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export const readCursor = (changelog) => CURSOR_RE.exec(changelog)?.[1] ?? null

/** PR numbers already listed in the changelog, so a PR is never released twice. */
export const listedPrNumbers = (changelog) =>
  new Set([...changelog.matchAll(/\[#(\d+)\]/g)].map((match) => Number(match[1])))

/** Include the boundary second; listed PR numbers prevent duplicates without losing simultaneous merges. */
export function selectPulls(pulls, { cursor, listed, releaseBranch = RELEASE_BRANCH }) {
  return pulls
    .filter((pull) => pull.merged_at)
    .filter((pull) => pull.head?.ref !== releaseBranch)
    .filter((pull) => !listed.has(pull.number))
    .filter((pull) => !cursor || Date.parse(pull.merged_at) >= Date.parse(cursor))
    .sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at))
}

export function renderSection({ version, date, pulls }) {
  const items = pulls.map((pull) => `- ${pull.title} ([#${pull.number}](${pull.html_url}))`)
  return `## ${version} - ${date}\n\n${items.join("\n")}\n`
}

/** Rebuilds the whole changelog: header, cursor, new section (if any), then the older sections. */
export function writeChangelog(existing, { cursor, section = null }) {
  const start = existing.search(/^## /m)
  const older = start === -1 ? "" : existing.slice(start)
  return [HEADER, `<!-- release-cursor: ${cursor} -->`, "", section ?? "", older].join("\n").replace(/\n{3,}/g, "\n\n")
}

/** Sets the version in package.json or package-lock.json text, keeping npm's formatting. */
export function setVersion(jsonText, version) {
  const data = JSON.parse(jsonText)
  data.version = version
  if (data.packages?.[""]) data.packages[""].version = version
  return `${JSON.stringify(data, null, 2)}\n`
}

export async function fetchClosedPulls({ repo, token, cursor, base, maxPages = 20 }) {
  const pulls = []
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}&base=${encodeURIComponent(base)}`
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} listing pulls: ${await res.text()}`)
    const batch = await res.json()
    pulls.push(...batch)
    if (batch.length < 100) return pulls
    // Sorted by updated_at (newest first): once a page reaches the cursor, older PRs cannot qualify.
    if (cursor && Date.parse(batch.at(-1).updated_at) < Date.parse(cursor)) return pulls
  }
  throw new Error(`More than ${maxPages * 100} closed PRs since the cursor; release by hand`)
}

async function readOr(file, fallback) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw error
  }
}

async function setOutputs(outputs) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  console.log(lines.join("\n"))
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`)
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  const base = process.env.RELEASE_BASE_BRANCH
  if (!repo || !token || !base) throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN and RELEASE_BASE_BRANCH must be set")

  const changelog = await readOr(CHANGELOG, "")
  const pkgText = await readFile("package.json", "utf8")
  const lockText = await readOr("package-lock.json", null)
  const now = new Date().toISOString()
  const cursor = readCursor(changelog)
  if (cursor && !Number.isFinite(Date.parse(cursor))) throw new Error("Invalid release cursor in CHANGELOG.md")
  if (changelog && !cursor) throw new Error("Existing CHANGELOG.md has no release cursor; set a baseline explicitly")

  // First run: no cursor yet. Record "now" as the baseline so only PRs merged afterwards are released.
  if (!cursor) {
    const baseline = process.env.RELEASE_BASELINE ?? now
    if (!Number.isFinite(Date.parse(baseline))) throw new Error("Invalid RELEASE_BASELINE")
    console.log(`No release cursor; setting baseline ${baseline}. Nothing is released on this run.`)
    if (!dryRun) await writeFile(CHANGELOG, writeChangelog(changelog, { cursor: baseline }))
    return setOutputs({ kind: "baseline", title: "Start weekly release changelog" })
  }

  const pulls = await fetchClosedPulls({ repo, token, cursor, base })
  const selected = selectPulls(pulls, { cursor, listed: listedPrNumbers(changelog) })
  if (selected.length === 0) {
    console.log(`No merged PRs since ${cursor}; no release.`)
    return setOutputs({ kind: "none" })
  }

  const bump = maxBump(selected.map((pull) => bumpFor(pull.labels ?? [])))
  const version = nextVersion(JSON.parse(pkgText).version, bump)
  const section = renderSection({ version, date: now.slice(0, 10), pulls: selected })
  const newCursor = selected.at(-1).merged_at
  console.log(`Releasing ${version} (${bump}) with ${selected.length} PR(s).\n\n${section}`)

  if (!dryRun) {
    await writeFile(CHANGELOG, writeChangelog(changelog, { cursor: newCursor, section }))
    await writeFile("package.json", setVersion(pkgText, version))
    if (lockText !== null) await writeFile("package-lock.json", setVersion(lockText, version))
    if (process.env.RELEASE_BODY_FILE) {
      const body = `${section}\n---\nBump came from PR labels (\`major\`, \`minor\`, \`patch\`; default \`patch\`). Merging updates files on main only. Nothing is published.\n`
      await writeFile(process.env.RELEASE_BODY_FILE, body)
    }
  }
  return setOutputs({ kind: "release", title: `Release ${version}` })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
