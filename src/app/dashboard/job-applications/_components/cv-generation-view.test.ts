import { describe, expect, it } from "vitest"
import { CvBriefSchema, CvSelectionSchema, StageLogEntrySchema, type CvGenerationStatus, type StageLogEntry } from "@/modules/cv-generation/schema"
import {
  PREVIEW_DETAIL,
  PREVIEW_NOTICE,
  briefRows,
  buildStageRows,
  cvGenerationHref,
  cvGenerationSignature,
  formatCost,
  formatDuration,
  formatTokens,
  isCvGenerationActive,
  selectionGroups,
  selectionSummary,
  employerBlocks,
  stageIndex,
  startResponseMessage,
  stageMeta,
} from "./cv-generation-view"

const entry = (over: Partial<StageLogEntry> & Pick<StageLogEntry, "stage">): StageLogEntry => StageLogEntrySchema.parse(over)
const run = (status: CvGenerationStatus, log: StageLogEntry[] = [], stageTimings = {}) => ({ status, log, stageTimings })
const states = (r: ReturnType<typeof run>) => buildStageRows(r).map((x) => x.state)

describe("run status helpers", () => {
  it("knows which statuses are active and gives the poller a signature only for them", () => {
    expect(isCvGenerationActive("writing")).toBe(true)
    expect(isCvGenerationActive("queued")).toBe(true)
    expect(isCvGenerationActive("complete")).toBe(false)
    expect(isCvGenerationActive("failed")).toBe(false)
    expect(isCvGenerationActive(null)).toBe(false)
    expect(cvGenerationSignature({ id: "r1", status: "writing" })).toBe("r1:writing")
    expect(cvGenerationSignature({ id: "r1", status: "complete" })).toBe("")
    expect(cvGenerationSignature({ id: "r1", status: "failed" })).toBe("")
    expect(cvGenerationSignature(null)).toBe("")
  })

  it("links to the job's generation log", () => {
    expect(cvGenerationHref("job-1")).toBe("/dashboard/job-applications/view/job-1/cv-generation")
  })

  it("indexes the current stage: -1 queued, stage count when finished", () => {
    expect(stageIndex("queued")).toBe(-1)
    expect(stageIndex("gathering")).toBe(0)
    expect(stageIndex("assembling")).toBe(4)
    expect(stageIndex("landing")).toBe(6)
    expect(stageIndex("complete")).toBe(7)
    expect(stageIndex("failed")).toBe(7)
  })
})

describe("buildStageRows", () => {
  it("lists all seven stages in pipeline order", () => {
    expect(buildStageRows(run("queued")).map((r) => r.stage)).toEqual(["gather", "brief", "select", "write", "assemble", "review", "land"])
  })

  it("marks earlier stages done, the current active and later ones waiting", () => {
    expect(states(run("queued"))).toEqual(Array(7).fill("waiting"))
    expect(states(run("selecting"))).toEqual(["done", "done", "active", "waiting", "waiting", "waiting", "waiting"])
    expect(states(run("landing"))).toEqual(["done", "done", "done", "done", "done", "done", "active"])
  })

  it("marks every stage done for a complete run, except ones logged as skipped", () => {
    const skip = entry({ stage: "review", status: "skipped", notes: ["reviewer unavailable"] })
    expect(states(run("complete"))).toEqual(Array(7).fill("done"))
    expect(states(run("complete", [skip]))[5]).toBe("skipped")
  })

  it("fails a failed run at the stage whose entry says failed", () => {
    const r = run("failed", [entry({ stage: "gather" }), entry({ stage: "brief" }), entry({ stage: "select", status: "failed" })])
    expect(states(r)).toEqual(["done", "done", "failed", "waiting", "waiting", "waiting", "waiting"])
  })

  it("fails a failed run at the first stage with no entry when none is logged as failed", () => {
    const r = run("failed", [entry({ stage: "gather" }), entry({ stage: "brief" })])
    expect(states(r)).toEqual(["done", "done", "failed", "waiting", "waiting", "waiting", "waiting"])
  })

  it("shows a failed run with no log at its first stage", () => {
    expect(states(run("failed"))).toEqual(["failed", "waiting", "waiting", "waiting", "waiting", "waiting", "waiting"])
  })

  it("does not invent a failed stage when every stage logged", () => {
    const all = (["gather", "brief", "select", "write", "assemble", "review", "land"] as const).map((stage) => entry({ stage }))
    expect(states(run("failed", all))).toEqual(Array(7).fill("done"))
  })

  it("takes duration from the log, else from the run's stage timings", () => {
    const rows = buildStageRows(run("complete", [entry({ stage: "gather", durationMs: 120 })], { gather: 999, brief: 4200 }))
    expect(rows[0].durationMs).toBe(120)
    expect(rows[1].durationMs).toBe(4200)
    expect(rows[2].durationMs).toBeNull()
  })

  it("attaches each stage's log entry", () => {
    const e = entry({ stage: "select", kept: ["a"], dropped: ["b", "c"] })
    const rows = buildStageRows(run("writing", [e]))
    expect(rows[2].entry).toEqual(e)
    expect(rows[0].entry).toBeNull()
  })
})

describe("formatters", () => {
  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850 ms")
    expect(formatDuration(4200)).toBe("4.2 s")
    expect(formatDuration(65_000)).toBe("1 m 05 s")
  })

  it("formats tokens and cost", () => {
    expect(formatTokens(820)).toBe("820")
    expect(formatTokens(12_400)).toBe("12.4k")
    expect(formatCost(0.054)).toBe("$0.05")
    expect(formatCost(0.004)).toBe("under $0.01")
    expect(formatCost(0)).toBe("$0.00")
  })
})

describe("stageMeta", () => {
  it("lists model, duration, tokens, cost and retries, leaving out what is absent", () => {
    const e = entry({ stage: "write", model: "some-model", durationMs: 4200, tokens: { input: 12_400, output: 820 }, costUsd: 0.05, retries: 1 })
    expect(stageMeta({ entry: e, durationMs: 4200 })).toEqual(["some-model", "4.2 s", "12.4k in · 820 out", "$0.05", "1 retry"])
    expect(stageMeta({ entry: entry({ stage: "gather" }), durationMs: 120 })).toEqual(["120 ms"])
    expect(stageMeta({ entry: null, durationMs: null })).toEqual([])
    expect(stageMeta({ entry: entry({ stage: "write", retries: 3 }), durationMs: null })).toEqual(["3 retries"])
  })
})

describe("preview runs (stages 0-2 only)", () => {
  const preview = [
    entry({ stage: "gather" }),
    entry({ stage: "brief", model: "m" }),
    entry({ stage: "select", model: "m" }),
  ]

  it("shows the stages that never ran as not run yet, not done", () => {
    expect(states({ ...run("complete", preview), partial: true } as never)).toEqual([
      "done", "done", "done", "waiting", "waiting", "waiting", "waiting",
    ])
  })

  it("still shows every stage done for a finished full run", () => {
    expect(states(run("complete"))).toEqual(Array(7).fill("done"))
  })

  it("labels the preview so it never reads as a finished CV", () => {
    expect(PREVIEW_NOTICE).toBe("Preview run: writing, review and draft stages are not built yet")
    expect(PREVIEW_DETAIL).toMatch(/No CV was written/)
  })
})

describe("startResponseMessage", () => {
  it("accepts a started or already-running run", () => {
    expect(startResponseMessage(202)).toEqual({ ok: true, message: null })
    expect(startResponseMessage(200)).toEqual({ ok: true, message: null })
  })

  it("explains each refusal", () => {
    expect(startResponseMessage(401).message).toMatch(/Sign in/)
    expect(startResponseMessage(404).message).toMatch(/not found/)
    expect(startResponseMessage(429).message).toMatch(/already running/)
    expect(startResponseMessage(500)).toMatchObject({ ok: false })
    expect(startResponseMessage(0).message).toMatch(/Couldn't start/)
  })
})

describe("briefRows", () => {
  const brief = CvBriefSchema.parse({
    hiddenQuestion: "Can they ship a migration?", leadWith: ["Migration delivery"],
    emphasise: [{ item: "Release management", why: "core of the role" }], playDown: [],
    positioning: "A delivery lead.", tone: "plain",
    budgets: { experiences: 3, skills: 8, tools: 6, competencies: 4, certifications: 2, education: 2, projects: 1 },
  })

  it("reads as labelled rows, in order, leaving out empty lists", () => {
    const rows = briefRows(brief)
    expect(rows.map((r) => r.label)).toEqual(["The hidden question", "Lead with", "Emphasise", "Positioning", "Tone", "Budget"])
    expect(rows[1].items).toEqual([{ text: "Migration delivery" }])
    // The item and its reason are separate, so the page can bold one and mute the other: no "X: Y: Z".
    // Only the Emphasise items are bold; Lead with is plain.
    expect(rows[2].items).toEqual([{ text: "Release management", strong: true, note: "core of the role" }])
    expect(rows[1].items?.some((i) => i.strong)).toBe(false)
    expect(JSON.stringify(rows[2].items)).not.toContain("Release management: core")
    expect(rows[5].text).toBe("Employers with bullets 3 · skills 8 · tools 6 · competencies 4 · certifications 2 · education 2 · projects 1")
  })
})

describe("selectionGroups", () => {
  const sel = CvSelectionSchema.parse({
    mode: "model",
    experiences: [{ id: "e1", label: "PM — Acme", reason: "most recent" }],
    activities: { e1: [{ id: "a1", label: "Cut release time", reason: "has a number" }] },
    skills: [{ id: "s1", label: "Release management", reason: "core" }],
    dropped: [
      { section: "experiences", id: "e2", label: "Intern — Old Co", why: "not_selected" },
      { section: "activities", id: "a2", label: "Ran standups", parentId: "e1", why: "over_cap" },
      { section: "activities", id: "a9", label: "Elsewhere", parentId: "e2", why: "role_not_kept" },
      { section: "skills", id: "ghost", label: "", why: "unknown_id" },
    ],
    droppedTotal: 4,
  })

  it("groups roles, each kept role's evidence and the flat sections, with why things were left out", () => {
    const groups = selectionGroups(sel)
    expect(groups.map((g) => g.title)).toEqual(["Roles with bullets", "Evidence: PM — Acme", "Skills", "Picked evidence that was not used (its employer has no bullets)"])
    expect(groups[0].kept).toEqual([{ label: "PM — Acme", reason: "most recent" }])
    expect(groups[0].dropped).toEqual([{ label: "Intern — Old Co", why: "not selected" }])
    expect(groups[1].dropped).toEqual([{ label: "Ran standups", why: "over the limit" }])
    expect(groups[2].dropped).toEqual([{ label: "ghost", why: "not in the profile" }])
    expect(groups[3].dropped).toEqual([{ label: "Elsewhere", why: "its employer was not kept" }])
  })

  it("shows header-only roles as their own group, and reads a stored row from before they existed", () => {
    expect(sel.headerOnlyRoles).toEqual([]) // an old row parses, with no header-only roles
    expect(selectionGroups(sel).some((g) => g.key === "headerOnly")).toBe(false)
    const withHeaders = CvSelectionSchema.parse({
      ...sel,
      headerOnlyRoles: [{ id: "e2", label: "Intern — Old Co" }],
      dropped: [{ section: "activities", id: "a9", label: "Elsewhere", parentId: "e2", why: "role_header_only" }],
    })
    const groups = selectionGroups(withHeaders)
    expect(groups.map((g) => g.title)).toEqual(["Roles with bullets", "Evidence: PM — Acme", "Listed without bullets", "Skills", "Picked evidence that was not used (its employer has no bullets)"])
    expect(groups[2].kept).toEqual([{ label: "Intern — Old Co", reason: "" }])
    expect(groups[4].dropped).toEqual([{ label: "Elsewhere", why: "its employer is listed without bullets" }])
    expect(selectionSummary(withHeaders)).toBe("4 kept, 4 left out")
  })

  it("shows a legacy header-only group only for rows stored with roles", () => {
    expect(selectionGroups(sel).some((g) => g.key === "headerOnly")).toBe(false)
  })

  it("leaves out sections with nothing to say", () => {
    expect(selectionGroups(sel).some((g) => g.key === "tools")).toBe(false)
  })

  it("summarises kept and left out, and says when rules chose", () => {
    expect(selectionSummary(sel)).toBe("3 kept, 4 left out")
    expect(selectionSummary({ ...sel, mode: "fallback" })).toMatch(/chosen by rules/)
  })
})

describe("employers (the stored shape from phase 2b)", () => {
  const roles = [
    { experienceId: "u1", title: "Program Manager", start: "2019-01-01", end: "2021-06-30" },
    { experienceId: "u3", title: "Snr. Program Manager", start: "2021-07-01", end: null },
  ]
  const sel = CvSelectionSchema.parse({
    mode: "model",
    employers: [
      {
        key: "unity", company: "Unity", latestTitle: "Snr. Program Manager", start: "2019-01-01", end: null, roles,
        progression: "Two roles at Unity (2019–present): Program Manager → Snr. Program Manager", relevance: 2, reason: "Current employer",
        headerOnly: false,
        bullets: [{ id: "u-a1", label: "Ran the release train", reason: "has a number", experienceId: "u1" }],
      },
      {
        key: "blizzard", company: "Blizzard", latestTitle: "Program Manager", start: "2014-01-01", end: "2018-12-31",
        roles: [{ experienceId: "b1", title: "Program Manager", start: "2014-01-01", end: "2018-12-31" }],
        progression: null, relevance: 5, headerOnly: false,
        bullets: [
          { id: "b-a1", label: "Shipped a live service", reason: "", experienceId: "b1" },
          { id: "b-a2", label: "Cut cert time", reason: "", experienceId: "b1" },
        ],
      },
      {
        key: "acme", company: "Acme", latestTitle: "Coordinator", start: "2010-01-01", end: "2013-12-31",
        roles: [{ experienceId: "c1", title: "Coordinator", start: "2010-01-01", end: "2013-12-31" }],
        progression: null, headerOnly: true, bullets: [],
      },
    ],
    skills: [{ id: "s1", label: "Agile", reason: "" }],
    dropped: [
      { section: "activities", id: "u-a2", label: "Ran standups", parentId: "unity", why: "over_cap" },
      { section: "activities", id: "c-a1", label: "Filed things", parentId: "acme", why: "role_header_only" },
      { section: "activities", id: "z-a1", label: "Gone", parentId: "zeta", why: "role_not_kept" },
      { section: "employers", id: "zeta", label: "Intern — Zeta", why: "over_cap" },
    ],
    droppedTotal: 4,
  })

  it("groups by employer: company, latest title, dates, progression sub-text, bullets and what was left out", () => {
    const w = employerBlocks(sel)
    expect(w.withBullets.map((e) => e.company)).toEqual(["Unity", "Blizzard"])
    const unity = w.withBullets[0]
    expect(unity).toMatchObject({
      title: "Snr. Program Manager", period: "Jan 2019 – present", relevance: 2,
      progression: "Two roles at Unity (2019–present): Program Manager → Snr. Program Manager",
    })
    expect(unity.kept).toEqual([{ label: "Ran the release train", reason: "has a number" }])
    expect(unity.dropped).toEqual([{ label: "Ran standups", why: "over the limit" }])
    expect(w.withBullets[1].progression).toBeNull()
    expect(w.withBullets[1].period).toBe("Jan 2014 – Dec 2018")
  })

  it("shows a returnee's stints, not one overall span", () => {
    const returnee = CvSelectionSchema.parse({
      mode: "model",
      employers: [{
        key: "unity", company: "Unity", latestTitle: "Snr. PM", start: "2015-01-01", end: null,
        stints: [{ start: "2015-01-01", end: "2017-01-01" }, { start: "2019-02-01", end: null }],
        roles: [], progression: null, relevance: 3, headerOnly: false, bullets: [],
      }],
    })
    expect(employerBlocks(returnee).withBullets[0].period).toBe("Jan 2015 – Jan 2017, Feb 2019 – present")
  })

  it("a header-only employer has no relevance to show", () => {
    expect(employerBlocks(sel).headerOnly[0].relevance).toBeUndefined()
    const noScore = CvSelectionSchema.parse({ mode: "model", employers: [{ key: "a", company: "A", latestTitle: "T", headerOnly: true }] })
    expect(employerBlocks(noScore).headerOnly[0].relevance).toBeUndefined()
  })

  it("lists header-only employers as their own group, and dropped employers", () => {
    const w = employerBlocks(sel)
    expect(w.headerOnly).toHaveLength(1)
    expect(w.headerOnly[0]).toMatchObject({ company: "Acme", title: "Coordinator", headerOnly: true, kept: [] })
    expect(w.headerOnly[0].dropped).toEqual([{ label: "Filed things", why: "its employer is listed without bullets" }])
    expect(w.dropped).toEqual([{ label: "Intern — Zeta", why: "over the limit" }])
  })

  it("leaves the work history to the employer blocks and keeps flat sections and unusable picks in the groups", () => {
    const groups = selectionGroups(sel)
    expect(groups.map((g) => g.title)).toEqual(["Skills", "Picked evidence that was not used (its employer has no bullets)"])
    expect(groups[1].dropped).toEqual([{ label: "Gone", why: "its employer was not kept" }])
  })

  it("counts employers and their bullets in the summary", () => {
    // 3 employers + 3 bullets + 1 skill
    expect(selectionSummary(sel)).toBe("7 kept, 4 left out")
  })

  it("reads a legacy row as no employers", () => {
    const legacy = CvSelectionSchema.parse({ mode: "model", experiences: [{ id: "e1", label: "PM — Acme" }] })
    expect(legacy.employers).toEqual([])
    expect(employerBlocks(legacy)).toEqual({ withBullets: [], headerOnly: [], dropped: [] })
    expect(selectionGroups(legacy)[0].title).toBe("Roles with bullets")
  })
})
