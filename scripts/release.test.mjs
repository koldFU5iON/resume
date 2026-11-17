import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  bumpFor,
  fetchClosedPulls,
  listedPrNumbers,
  maxBump,
  nextVersion,
  readCursor,
  renderSection,
  selectPulls,
  setVersion,
  writeChangelog,
} from "./release.mjs"

const pull = (number, merged_at, labels = [], ref = `feat/${number}`) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/o/r/pull/${number}`,
  merged_at,
  labels: labels.map((name) => ({ name })),
  head: { ref },
})

describe("version policy", () => {
  it("picks the highest explicit label, defaulting to patch", () => {
    expect(bumpFor([])).toBe("patch")
    expect(bumpFor([{ name: "patch" }])).toBe("patch")
    expect(bumpFor([{ name: "Minor" }])).toBe("minor")
    expect(bumpFor([{ name: "minor" }, { name: "major" }])).toBe("major")
    expect(maxBump(["patch", "minor", "patch"])).toBe("minor")
  })

  it("bumps SemVer", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1")
    expect(nextVersion("0.1.9", "minor")).toBe("0.2.0")
    expect(nextVersion("0.2.3", "major")).toBe("1.0.0")
    expect(() => nextVersion("1.0", "patch")).toThrow()
  })
})

describe("selection", () => {
  const pulls = [
    pull(3, "2026-11-10T10:00:00Z"),
    pull(1, "2026-11-08T10:00:00Z"),
    pull(4, "2026-11-12T10:00:00Z", [], "release/weekly"),
    pull(5, null),
    pull(2, "2026-11-09T10:00:00Z"),
  ]
  const cursor = "2026-11-09T10:00:00Z"

  it("includes the cursor second, oldest first, without the release PR", () => {
    expect(selectPulls(pulls, { cursor, listed: new Set([2]) }).map((p) => p.number)).toEqual([3])
    expect(selectPulls(pulls, { cursor, listed: new Set() }).map((p) => p.number)).toEqual([2, 3])
  })

  it("skips PRs already listed in the changelog", () => {
    const listed = listedPrNumbers("## 0.1.1 - x\n\n- Old ([#3](https://x/pull/3))\n")
    expect(selectPulls(pulls, { cursor, listed: new Set([...listed, 2]) })).toEqual([])
  })

  it("without a cursor, returns every merged PR oldest first", () => {
    expect(selectPulls(pulls, { cursor: null, listed: new Set() }).map((p) => p.number)).toEqual([1, 2, 3])
  })
})

describe("GitHub pagination", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads past a full page at the cursor second and filters by the release base", async () => {
    const cursor = "2026-11-09T10:00:00Z"
    const batch = Array.from({ length: 100 }, (_, i) => ({ ...pull(i + 1, cursor), updated_at: cursor }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => batch })
      .mockResolvedValueOnce({ ok: true, json: async () => [pull(101, cursor)] })
    vi.stubGlobal("fetch", fetchMock)
    const pulls = await fetchClosedPulls({ repo: "o/r", token: "test", cursor, base: "main" })
    expect(pulls).toHaveLength(101)
    expect(fetchMock.mock.calls[1][0]).toContain("page=2&base=main")
  })

  it("fails on API errors and pagination limits instead of releasing incomplete results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Denied" })
    vi.stubGlobal("fetch", fetchMock)
    const options = { repo: "o/r", token: "test", base: "main", maxPages: 1 }
    await expect(fetchClosedPulls(options)).rejects.toThrow("GitHub API 403")
    fetchMock.mockResolvedValue({ ok: true, json: async () => Array.from({ length: 100 }, () => pull(1, "2026-11-09T10:00:00Z")) })
    await expect(fetchClosedPulls(options)).rejects.toThrow("More than 100")
  })
})

describe("changelog", () => {
  it("writes the cursor, prepends the new section, and keeps older sections", () => {
    const older = writeChangelog("", { cursor: "2026-11-01T00:00:00Z", section: "## 0.1.0 - 2026-11-01\n\n- Old (#1)\n" })
    const section = renderSection({ version: "0.1.1", date: "2026-11-08", pulls: [pull(2, "2026-11-07T00:00:00Z")] })
    const next = writeChangelog(older, { cursor: "2026-11-07T00:00:00Z", section })

    expect(readCursor(next)).toBe("2026-11-07T00:00:00Z")
    expect(next.indexOf("## 0.1.1")).toBeLessThan(next.indexOf("## 0.1.0"))
    expect(next).toContain("- PR 2 ([#2](https://github.com/o/r/pull/2))")
    expect(next.match(/release-cursor/g)).toHaveLength(1)
  })

  it("baseline writes only the header and cursor", () => {
    const text = writeChangelog("", { cursor: "2026-11-17T06:00:00.000Z" })
    expect(readCursor(text)).toBe("2026-11-17T06:00:00.000Z")
    expect(text).not.toMatch(/^## /m)
  })

  it("keeps npm's JSON formatting when setting the version", () => {
    const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")
    expect(setVersion(lock, "0.1.0")).toBe(lock)
    const bumped = JSON.parse(setVersion(lock, "9.9.9"))
    expect(bumped.version).toBe("9.9.9")
    expect(bumped.packages[""].version).toBe("9.9.9")
  })
})
