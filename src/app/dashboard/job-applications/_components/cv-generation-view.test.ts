import { describe, expect, it } from "vitest"
import { CvBriefSchema, CvSelectionSchema, SectionLogEntrySchema, StageLogEntrySchema, type CvGenerationStatus, type StageLogEntry } from "@/modules/cv-generation/schema"
import {
  CHECK_NOTE_PREFIX, parseAssembled,
} from "@/modules/cv-generation/schema"
import {
  allConcernsCoachMessage,
  concernCoachMessage,
  PREVIEW_DETAIL,
  PREVIEW_NOTICE,
  assembledSummary,
  previewCopy,
  retryReasonLine,
  sectionMeta,
  stageNotes,
  uncoveredLine,
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
  runLogMarkdown,
  COMPLETE_HEADING,
  EDITED_BY_REVIEW,
  concernRows,
  draftHref,
  reviewMarkdown,
  reviewSummary,
  PROVENANCE_SUMMARY,
  bulletSourceLines,
  provenanceBySection,
  sourceLine,
} from "./cv-generation-view"
import { leads, em } from '../../../../modules/cv-generation/__fixtures__/candidates'

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
    expect(PREVIEW_NOTICE).toBe("Preview run (made before drafts existed): no review, no draft. The assembled CV is below.")
    expect(PREVIEW_DETAIL).toMatch(/no draft was created/)
  })

  it("labels a preview stored before the writing stages existed as selection only, never as having a CV below", () => {
    expect(previewCopy(true).notice).toBe(PREVIEW_NOTICE)
    expect(previewCopy(false).notice).toBe("Preview run: selection only")
    expect(previewCopy(false).detail).toMatch(/no assembled CV/)
    expect(previewCopy(false).notice).not.toMatch(/below/)
  })

  it("shows write and assemble rows as done for a complete preview run that logged them", () => {
    const rows = buildStageRows({
      status: "complete", partial: true, stageTimings: {},
      log: ["gather", "brief", "select", "write", "assemble"].map((stage) => entry({ stage: stage as StageLogEntry["stage"] })),
    })
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "done", "done", "waiting", "waiting"])
  })

  it("marks the write stage failed when its entry says so, and the later stages as not run", () => {
    const rows = buildStageRows({ status: "failed", stageTimings: {}, log: [entry({ stage: "gather" }), entry({ stage: "brief" }), entry({ stage: "select" }), entry({ stage: "write", status: "failed" })] })
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "failed", "waiting", "waiting", "waiting"])
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
    expect(startResponseMessage(409).message).toMatch(/draft waiting/)
    expect(startResponseMessage(429).message).toMatch(/already running/)
    expect(startResponseMessage(500)).toMatchObject({ ok: false })
    expect(startResponseMessage(0).message).toMatch(/Couldn't start/)
  })
})

describe("briefRows", () => {
  const brief = CvBriefSchema.parse({
    hiddenQuestion: "Can they ship a migration?", leadWith: leads(["Migration delivery"]),
    emphasise: [em("Release management", "core of the role")], playDown: [],
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
    expect(rows[5].text).toBe("Employers with bullets 4 · skills 12 · tools 6 · competencies 8 · certifications 6 · education 2 · projects 1")
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

describe("write and assemble rows (phase 3)", () => {
  it("lists a section's model, time, tokens, cost and retries, and says when code wrote it", () => {
    const sec = { model: "claude-sonnet-5-5", durationMs: 4200, tokens: { input: 1200, output: 300 }, costUsd: 0.012, retries: 1 }
    expect(sectionMeta(sec)).toEqual(["claude-sonnet-5-5", "4.2 s", "1.2k in · 300 out", "$0.01", "1 retry"])
    expect(sectionMeta({ model: null, durationMs: 0, tokens: { input: 0, output: 0 }, costUsd: null, retries: 0 })).toEqual(["by code"])
  })

  it("never shows more than three \"worth a quick check\" notes on the Assemble row, whatever the stored log holds", () => {
    const notes = ["Assembled 9 sections.", ...Array.from({ length: 6 }, (_, i) => `${CHECK_NOTE_PREFIX}note ${i}`)]
    const shown = stageNotes({ stage: "assemble", notes })
    expect(shown.filter((n) => n.startsWith(CHECK_NOTE_PREFIX))).toHaveLength(3)
    expect(shown[0]).toBe("Assembled 9 sections.")
    expect(stageNotes({ stage: "write", notes }).length).toBe(7)
  })

  it("summarises the assembled CV, and a stored run without one reads as none", () => {
    const a = parseAssembled({ markdown: "# A\n\nOne two three four.", sections: [{ id: "a", kind: "k", markdown: "m" }], warnings: [], checkNotes: [] })!
    expect(assembledSummary(a)).toBe("1 section · about 6 words")
    expect(parseAssembled(null)).toBeNull()
  })

  it("reports the emphasise items no kept evidence supports, or nothing", () => {
    const sel = CvSelectionSchema.parse({ mode: "model", uncovered: ["Regulatory compliance", "Vendor management"] })
    expect(uncoveredLine(sel)).toBe("No kept evidence supports these emphasise items: Regulatory compliance; Vendor management")
    expect(uncoveredLine({ uncovered: ["X"] })).toBe("No kept evidence supports this emphasise item: X")
    expect(uncoveredLine(CvSelectionSchema.parse({ mode: "model" }))).toBeNull()
  })
})

describe("retryReasonLine (why a stage or section retried)", () => {
  it("lists the recorded reasons on one line", () => {
    expect(retryReasonLine({ retries: 1, retryReasons: ["figure 14k not in evidence", "first person"] })).toBe("Retried because: figure 14k not in evidence; first person")
  })

  it("says nothing when there was no retry, or the stored row has no reasons", () => {
    expect(retryReasonLine({ retries: 0, retryReasons: ["first person"] })).toBeNull()
    expect(retryReasonLine({ retries: 1, retryReasons: [] })).toBeNull()
    expect(retryReasonLine({ retries: 1 })).toBeNull()
  })

  it("reads the reasons of a stored section row, and a row stored before they existed has none", () => {
    const row = StageLogEntrySchema.parse({ stage: "write", retries: 1, sections: [{ id: "experience:unity", label: "x", retries: 1, retryReasons: ["duplicate figure 14,000"] }, { id: "skills", label: "y", retries: 1 }] })
    expect(retryReasonLine(row.sections[0])).toBe("Retried because: duplicate figure 14,000")
    expect(retryReasonLine(row.sections[1])).toBeNull()
    expect(sectionMeta(row.sections[0])).toContain("1 retry")
  })
})

describe("runLogMarkdown (the Copy log text)", () => {
  const brief = CvBriefSchema.parse({
    hiddenQuestion: "Can they ship a migration?", leadWith: leads(["The Enemies Demo Campaign"]),
    emphasise: [em("Release management", "core of the role")], playDown: ["Build detail"],
    positioning: "A delivery lead.", tone: "plain",
    budgets: { experiences: 2, skills: 8, tools: 6, competencies: 4, certifications: 2, education: 2, projects: 1 },
  })
  const selection = CvSelectionSchema.parse({
    mode: "model",
    employers: [
      {
        key: "unity", company: "Unity", latestTitle: "Snr. Program Manager", start: "2019-01-01", end: null,
        roles: [{ experienceId: "u1", title: "Snr. Program Manager", start: "2019-01-01", end: null }],
        progression: null, relevance: 5, reason: "Current employer", headerOnly: false,
        bullets: [{ id: "u-a1", label: "Ran the release train", reason: "has a number", experienceId: "u1" }],
      },
      { key: "acme", company: "Acme", latestTitle: "Coordinator", start: "2010-01-01", end: "2013-12-31", roles: [{ experienceId: "c1", title: "Coordinator", start: "2010-01-01", end: "2013-12-31" }], progression: null, headerOnly: true, bullets: [] },
    ],
    skills: [{ id: "s1", label: "Release management", reason: "core" }],
    dropped: [
      { section: "activities", id: "x1", label: "Ran standups", parentId: "unity", why: "over_cap" },
      { section: "skills", id: "s2", label: "Budgeting", why: "not_selected" },
    ],
    droppedTotal: 2,
    uncovered: ["Regulatory compliance"],
  })
  const log = [
    entry({ stage: "gather", notes: ["Profile: 3 roles."] }),
    entry({ stage: "brief", model: "claude-opus-5-5", durationMs: 8200, tokens: { input: 3100, output: 420 }, costUsd: 0.12 }),
    entry({ stage: "select", model: "claude-haiku-5-5", durationMs: 2100, tokens: { input: 5000, output: 900 }, costUsd: 0.01, retries: 1, retryReasons: ["the answer was cut off"], notes: ["Cut 2 picks over the limits."] }),
    entry({
      stage: "write", model: "claude-sonnet-5-5", durationMs: 41000, tokens: { input: 14400, output: 3500 }, costUsd: 0.13,
      sections: [{
        id: "experience:unity", label: "Experience: Snr. Program Manager — Unity", status: "ok", model: "claude-sonnet-5-5", durationMs: 30000,
        tokens: { input: 9000, output: 2200 }, costUsd: 0.09, retries: 1, retryReasons: ["there are 8 bullets, limit 6"],
        notes: ["Cut a bullet over this employer's limit of 6: “Kept the calendar.”"],
      }],
    }),
    entry({ stage: "assemble", notes: ["Assembled 9 sections (about 640 words).", `${CHECK_NOTE_PREFIX}"14,000" could not be matched.`] }),
  ]
  const assembled = {
    markdown: ":::header\n# Robin Placeholder\n{{contact}}\n:::\n\n## Experience\n\n:::compact-list\n- Ran the Unity Awards.\n:::\n",
    warnings: ["Heading skipped a level (line 4)"], checkNotes: ["Unity: \"14,000\" could not be matched to the profile text. Worth a quick check."],
  }
  const run = {
    id: "run-abc", status: "complete" as const, createdAt: new Date("2026-11-18T10:00:00Z"), startedAt: new Date("2026-11-18T10:00:01Z"), completedAt: new Date("2026-11-18T10:01:33Z"),
    partial: true, log, stageTimings: {}, brief, selection, assembled,
    usage: { total: { requests: 7, failedRequests: 1, inputTokens: 33_000, outputTokens: 6_000, estimatedCostUsd: 0.32, estimateComplete: true } },
  }
  const md = runLogMarkdown({ jobTitle: "Senior Product Marketing Manager", company: "Canonical", run })

  it("starts with the job, run id, date, status and the totals: cost, tokens, calls and duration", () => {
    expect(md.startsWith("# CV generation log: Senior Product Marketing Manager at Canonical\n")).toBe(true)
    expect(md).toContain("- Run: run-abc")
    expect(md).toContain("- Date: 2026-11-18T10:00:00.000Z")
    expect(md).toContain("- Status: Complete (preview run made before drafts existed: no review, no draft)")
    expect(md).toContain("- Cost (estimate): $0.32")
    expect(md).toContain("- Calls: 7 (1 failed)")
    expect(md).toContain("- Tokens: 33.0k in · 6.0k out")
    expect(md).toContain("- Duration: 1 m 32 s")
  })

  it("has the Brief, the Selection and every stage that logged, in that order, then the assembled CV at the end", () => {
    const at = (h: string) => md.indexOf(h)
    expect([at("## Brief"), at("## Selection"), at("## Stages"), at("## Assembled CV")].every((i) => i > 0)).toBe(true)
    expect(at("## Brief")).toBeLessThan(at("## Selection"))
    expect(at("## Selection")).toBeLessThan(at("## Stages"))
    expect(at("## Stages")).toBeLessThan(at("## Assembled CV"))
    for (const h of ["### Gather", "### Brief", "### Select", "### Write", "### Assemble"]) expect(md).toContain(h)
    expect(md).not.toContain("### Review")
    expect(md.trimEnd().endsWith("```")).toBe(true)
    expect(md).toContain("```markdown\n:::header\n# Robin Placeholder\n{{contact}}\n:::")
  })

  it("the Brief carries the hidden question, lead with, emphasise with reasons and play down", () => {
    expect(md).toContain("**The hidden question:** Can they ship a migration?")
    expect(md).toContain("- The Enemies Demo Campaign")
    expect(md).toContain("- Release management — core of the role")
    expect(md).toContain("Build detail")
  })

  it("the Selection has each employer with its kept bullets and left-out count, header-only employers, the flat sections and the uncovered emphasise items", () => {
    expect(md).toContain("### Unity: Snr. Program Manager (Jan 2019 – present)")
    expect(md).toContain("Relevance 5/5, 1 bullet kept, 1 left out · Current employer")
    expect(md).toContain("- Ran the release train (has a number)")
    expect(md).toContain("### Listed without bullets")
    expect(md).toContain("- Acme: Coordinator")
    expect(md).toContain("### Skills: 1 kept, 1 left out")
    expect(md).toMatch(/\*\*Uncovered:\*\* No kept evidence supports this emphasise item: Regulatory compliance/)
  })

  it("every stage has its model, time, tokens, cost, retries and why, its notes, the section rows and the check notes", () => {
    expect(md).toContain("### Brief: ok · claude-opus-5-5 · 8.2 s · 3.1k in · 420 out · $0.12")
    expect(md).toContain("1 retry")
    expect(md).toContain("Retried because: the answer was cut off")
    expect(md).toContain("- Cut 2 picks over the limits.")
    expect(md).toContain("- **Experience: Snr. Program Manager — Unity**: claude-sonnet-5-5 · 30.0 s · 9.0k in · 2.2k out · $0.09 · 1 retry")
    expect(md).toContain("  - Retried because: there are 8 bullets, limit 6")
    expect(md).toContain("Cut a bullet over this employer's limit of 6")
    expect(md).toContain("Worth a quick check:")
    expect(md).toContain("could not be matched to the profile text")
    expect(md).toContain("Warnings (1):")
  })

  it("holds no contact details: the CV carries the {{contact}} placeholder and nothing reads a contact field", () => {
    expect(md).toContain("{{contact}}")
    expect(md).not.toMatch(/@|\+\d{6,}|https?:\/\//) // no email, phone or link
  })

  it("fences the CV with a longer fence when the CV itself holds backticks", () => {
    const tricky = runLogMarkdown({ jobTitle: "J", company: null, run: { ...run, assembled: { ...assembled, markdown: "Has ``` inside\n" } } })
    expect(tricky).toContain("````markdown\nHas ``` inside\n````")
  })

  it("a failed run shows its failure and still produces the log it has", () => {
    const failed = runLogMarkdown({ jobTitle: "J", company: null, run: { id: "r", status: "failed", createdAt: "2026-11-18T10:00:00Z", failureMessage: "The model timed out.", log: [entry({ stage: "gather" })], stageTimings: { gather: 900 } } })
    expect(failed).toContain("- Status: Failed")
    expect(failed).toContain("- Failure: The model timed out.")
    expect(failed).toContain("- Duration: 900 ms")
    expect(failed).toContain("# CV generation log: J\n")
  })

  it("handles a run stored before the later phases: no brief, no selection, no assembled CV, no retry reasons, no usage", () => {
    const old = runLogMarkdown({ jobTitle: "", company: "  ", run: { id: "old", status: "complete", createdAt: new Date("2026-11-01T00:00:00Z"), log: [entry({ stage: "select", retries: 1 })], stageTimings: {} } })
    expect(old).toContain("# CV generation log: Untitled job")
    expect(old).toContain("- Cost (estimate): none recorded")
    expect(old).not.toContain("## Brief")
    expect(old).not.toContain("## Selection")
    expect(old).not.toContain("## Assembled CV")
    expect(old).toContain("### Select: ok")
    expect(old).not.toContain("Retried because") // a row with no recorded reasons shows none
  })

  it("handles nothing at all: no log, a bad date", () => {
    const bare = runLogMarkdown({ jobTitle: "J", company: null, run: { id: "r", status: "queued", createdAt: "not a date", log: null, stageTimings: null } })
    expect(bare).toContain("- Date: unknown")
    expect(bare).not.toContain("## Stages")
  })
})

describe("per-bullet provenance on the log (Phase 3d)", () => {
  const bullets = [
    { text: "Cut asset collection from 4 weeks to 1 week across 150 customer projects.", sources: [{ id: "a1", kind: "activity" as const, snippet: "Cut asset collection from 4 weeks to 1 week for the Unity Awards" }] },
    { text: "Ran the Enemies Demo Campaign.", sources: [{ id: "p1", kind: "project" as const, snippet: "Enemies Demo Campaign: ran the demo" }, { id: "a2", kind: "activity" as const, snippet: "Launched the demo" }] },
    { text: "Kept the release calendar.", sources: [] },
  ]
  const assembled = {
    markdown: ":::header\n# Robin\n{{contact}}\n:::\n",
    warnings: [], checkNotes: [],
    sections: [
      { id: "experience:unity", kind: "experience", employerKey: "unity", markdown: "### Unity", bullets },
      { id: "earlier-experience", kind: "earlier-experience", markdown: ":::compact-list\n- Old Co — Coordinator, 2010–2014\n:::" },
    ],
  }

  it("formats a source as 'from: <snippet> (activity|project)', and says when the writer cited none", () => {
    expect(sourceLine(bullets[0].sources[0])).toBe("from: Cut asset collection from 4 weeks to 1 week for the Unity Awards (activity)")
    expect(bulletSourceLines(bullets[1])).toEqual(["from: Enemies Demo Campaign: ran the demo (project)", "from: Launched the demo (activity)"])
    expect(bulletSourceLines(bullets[2])).toEqual(["from: no source cited"])
  })

  it("finds the provenance by section id, leaving out sections without bullets and runs stored before provenance", () => {
    const map = provenanceBySection(assembled)
    expect([...map.keys()]).toEqual(["experience:unity"])
    expect(provenanceBySection(null).size).toBe(0)
    expect(provenanceBySection(parseAssembled({ markdown: "# x", sections: [{ id: "experience:unity", kind: "experience", markdown: "m" }] })).size).toBe(0)
  })

  const md = runLogMarkdown({
    jobTitle: "J", company: null,
    run: {
      id: "r", status: "complete", createdAt: new Date("2026-11-18T10:00:00Z"), assembled, stageTimings: {},
      log: [entry({ stage: "write", sections: [
        SectionLogEntrySchema.parse({ id: "experience:unity", label: "Experience: Snr. Program Manager — Unity", notes: ["Bullet combines figures from 2 activities: A / B"] }),
        SectionLogEntrySchema.parse({ id: "earlier-experience", label: "Earlier experience", notes: ["1 employer listed without bullets."] }),
      ] })],
    },
  })

  it("Copy log lists, under each experience row, 'Where each bullet came from': the bullet, then its sources", () => {
    expect(md).toContain(`  - ${PROVENANCE_SUMMARY}:`)
    expect(md).toContain("    - Cut asset collection from 4 weeks to 1 week across 150 customer projects.\n      - from: Cut asset collection from 4 weeks to 1 week for the Unity Awards (activity)")
    expect(md).toContain("    - Ran the Enemies Demo Campaign.\n      - from: Enemies Demo Campaign: ran the demo (project)\n      - from: Launched the demo (activity)")
    expect(md).toContain("    - Kept the release calendar.\n      - from: no source cited")
    expect(md).toContain("  - Bullet combines figures from 2 activities: A / B") // the mixed-source note is in the row's notes
  })

  it("puts the provenance under the experience row only, not under the Earlier experience row", () => {
    const earlier = md.slice(md.indexOf("**Earlier experience**"))
    expect(earlier).not.toContain(PROVENANCE_SUMMARY)
    expect(md.match(new RegExp(PROVENANCE_SUMMARY, "g"))).toHaveLength(1)
  })

  it("a run stored before provenance still produces its log, with no provenance block", () => {
    const old = runLogMarkdown({ jobTitle: "J", company: null, run: { id: "r", status: "complete", createdAt: "2026-11-01T00:00:00Z", assembled: { markdown: "x\n", warnings: [], checkNotes: [], sections: [{ id: "experience:unity", kind: "experience", markdown: "m" }] }, stageTimings: {}, log: [entry({ stage: "write", sections: [SectionLogEntrySchema.parse({ id: "experience:unity", label: "Unity" })] })] } })
    expect(old).toContain("**Unity**")
    expect(old).not.toContain(PROVENANCE_SUMMARY)
  })

  it("adds no contact detail", () => {
    expect(md).not.toMatch(/@|\+\d{6,}|https?:\/\//)
  })
})

describe("Review, Land and reuse on the log (phase 4a)", () => {
  const review = {
    skipped: false, skipReason: null, model: "claude-opus-5-5", tokens: { input: 4000, output: 600 }, costUsd: 0.21,
    applied: [{ sectionId: "experience:unity", bulletId: "b2", action: "replace" as const, before: "Ran 14,000 voters", after: "Ran voter campaigns", reason: "figure not in the evidence", note: "" }],
    discarded: [{ sectionId: "header", bulletId: null, action: "remove" as const, proposed: null, why: "that section is rendered by code from your profile and is read-only", reason: "x" }],
    concerns: [
      { kind: "metric_conflict" as const, title: "Two figures for asset collection", why: "4 weeks to 1 week vs 3 weeks to under an hour.", question: "Which figure describes the Unity Awards work?", refs: [{ label: "S1", snippet: "Cut asset collection from 4 weeks to 1 week" }] },
      { kind: "evidence_gap" as const, title: "No migration evidence", why: "The brief leads with it.", question: "Have you led a platform migration?", refs: [] },
    ],
  }
  const base = { id: "run-1", status: "complete" as const, createdAt: "2026-11-18T10:00:00Z", stageTimings: {}, log: [entry({ stage: "gather" })] }

  it("labels the complete heading and links the draft", () => {
    expect(COMPLETE_HEADING).toBe("CV drafted: review it in the writing desk")
    expect(draftHref("job-1", "doc-1")).toBe("/dashboard/job-applications/view/job-1/writing/doc-1")
  })

  it("summarises a review, a skipped review and a missing one", () => {
    expect(reviewSummary(review)).toBe("Applied 1 edit, discarded 1, 2 concerns for the coach")
    expect(reviewSummary({ ...review, skipped: true, skipReason: "The review timed out, so the CV landed unreviewed." })).toBe("Review skipped: The review timed out, so the CV landed unreviewed.")
    expect(reviewSummary(null)).toBeNull()
    expect(reviewSummary({ ...review, skipped: true, skipReason: null })).toMatch(/no reason recorded/)
  })

  it("lists the concerns with a kind badge, title, why, the question and the evidence snippets", () => {
    const rows = concernRows(review)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      kind: "metric_conflict", badge: "Conflicting figures", title: "Two figures for asset collection",
      why: "4 weeks to 1 week vs 3 weeks to under an hour.", question: "Which figure describes the Unity Awards work?", refs: ["Cut asset collection from 4 weeks to 1 week"],
    })
    expect(rows[1].badge).toBe("Evidence gap")
    expect(concernRows(null)).toEqual([])
    expect(concernRows({ concerns: [] })).toEqual([])
  })

  it("Copy log carries the applied edits, the discarded edits with why, and the concerns with their questions", () => {
    const md = runLogMarkdown({ jobTitle: "J", company: null, run: { ...base, review } })
    expect(md).toContain("## Review")
    expect(md).toContain("Applied 1 edit, discarded 1, 2 concerns for the coach")
    expect(md).toContain("- replace experience:unity b2: “Ran 14,000 voters” → “Ran voter campaigns” (figure not in the evidence)")
    expect(md).toContain("- remove header: that section is rendered by code from your profile and is read-only")
    expect(md).toContain("- **Two figures for asset collection** (Conflicting figures): 4 weeks to 1 week vs 3 weeks to under an hour.")
    expect(md).toContain("  - Question: Which figure describes the Unity Awards work?")
    expect(md).toContain("  - Evidence: Cut asset collection from 4 weeks to 1 week")
  })

  it("Copy log says why a review was skipped, names the reuse source and the draft, and never says preview for a new run", () => {
    const md = runLogMarkdown({
      jobTitle: "J", company: null,
      run: { ...base, review: { ...review, skipped: true, skipReason: "The review was turned off for this run, so the CV lands unreviewed.", applied: [], discarded: [], concerns: [] }, selectionReusedFromRunId: "run-0", writingDeskDocumentId: "doc-1", partial: false },
    })
    expect(md).toContain("Review skipped: The review was turned off for this run")
    expect(md).toContain("- Brief and selection: reused from run run-0 (nothing changed since)")
    expect(md).toContain("- Draft: writing desk document doc-1")
    expect(md).not.toMatch(/preview/i)
  })

  it("Copy log has no Review section for a run stored before Phase 4a, and does not crash", () => {
    const md = runLogMarkdown({ jobTitle: "J", company: null, run: base })
    expect(md).not.toContain("## Review")
    expect(reviewMarkdown(undefined)).toEqual([])
  })

  it("shows the Review and Land rows: a skipped review, the reuse note on Brief and Select, a complete run's stepper all done", () => {
    const rows = buildStageRows({
      status: "complete", stageTimings: {},
      log: [
        entry({ stage: "brief", status: "skipped", notes: ["Reused the brief and selection from the run of 10 Nov 2026 (nothing changed since)"] }),
        entry({ stage: "review", status: "skipped", notes: ["The review was turned off for this run, so the CV lands unreviewed."] }),
        entry({ stage: "land", status: "ok", notes: ["Created a new CV document and saved the CV as a draft in it"] }),
      ],
    })
    expect(rows.map((r) => `${r.stage}:${r.state}`)).toEqual(["gather:done", "brief:skipped", "select:done", "write:done", "assemble:done", "review:skipped", "land:done"])
  })

  it("a run that failed in Land shows Land failed and the earlier stages done", () => {
    const rows = buildStageRows({
      status: "failed", stageTimings: {},
      log: ["gather", "brief", "select", "write", "assemble", "review"].map((stage) => entry({ stage: stage as never })).concat(entry({ stage: "land", status: "failed", notes: ["A draft appeared"] })),
    })
    expect(rows.at(-1)!.state).toBe("failed")
    expect(rows.slice(0, 6).every((r) => r.state === "done")).toBe(true)
  })
})

describe("bullets the review reworded (review fix 7)", () => {
  it("say so first, then list the sources that are still cited", () => {
    const src = { id: "a1", kind: "activity" as const, snippet: "Cut asset collection from 4 weeks to 1 week" }
    expect(bulletSourceLines({ sources: [src], editedByReview: true })).toEqual([EDITED_BY_REVIEW, "from: Cut asset collection from 4 weeks to 1 week (activity)"])
    expect(bulletSourceLines({ sources: [], editedByReview: true })).toEqual([EDITED_BY_REVIEW])
    expect(bulletSourceLines({ sources: [] })).toEqual(["from: no source cited"])
    expect(bulletSourceLines({ sources: [src] })).toEqual(["from: Cut asset collection from 4 weeks to 1 week (activity)"])
  })
})

describe("coach messages for concerns (prefilled, never sent)", () => {
  const c = { kind: "metric_conflict", badge: "Conflicting figures", title: "Two figures", why: "They differ.", question: "Which is right?", refs: ["4 weeks to 1 week"] }
  const d = { kind: "weak_proof", badge: "Thin proof", title: "Thin proof", why: "", question: "What was the result?", refs: [] }

  it("names the job, the concern, its question and evidence", () => {
    const m = concernCoachMessage(c, { title: "Senior PMM", company: "Canonical" })
    for (const t of ["Senior PMM at Canonical", "Two figures", "They differ.", "Which is right?", "4 weeks to 1 week"]) expect(m).toContain(t)
  })

  it("asks the coach not to change the profile", () => {
    expect(concernCoachMessage(c, { title: "PMM" })).toMatch(/Don't change my profile/)
    expect(concernCoachMessage(c, { title: "PMM" })).not.toContain(" at null")
  })

  it("covers every concern for 'discuss all'", () => {
    const m = allConcernsCoachMessage([c, d], { title: "PMM" })
    expect(m).toContain("2 questions")
    expect(m).toContain("Two figures")
    expect(m).toContain("What was the result?")
  })
})

describe("collapsible log sections", () => {
  it("collapses every section while a run is active", async () => {
    const v = await import("./cv-generation-view")
    for (const s of ["queued", "briefing", "selecting", "writing", "reviewing"] as const) {
      for (const id of ["concerns", "assembled", "brief", "stage:write"]) expect(v.defaultSectionOpen(s, id), `${s}/${id}`).toBe(false)
    }
  })

  it("opens Concerns and Assembled CV on a finished run, and nothing else", async () => {
    const v = await import("./cv-generation-view")
    for (const s of ["complete", "failed"] as const) {
      expect(v.defaultSectionOpen(s, "concerns")).toBe(true)
      expect(v.defaultSectionOpen(s, "assembled")).toBe(true)
      expect(v.defaultSectionOpen(s, "brief")).toBe(false)
      expect(v.defaultSectionOpen(s, "stage:select")).toBe(false)
    }
  })

  it("keeps a manual choice over the status default, including when the run finishes", async () => {
    const v = await import("./cv-generation-view")
    expect(v.resolveSectionOpen({ brief: true }, "writing", "brief")).toBe(true)
    expect(v.resolveSectionOpen({ brief: true }, "complete", "brief")).toBe(true)
    expect(v.resolveSectionOpen({ concerns: false }, "complete", "concerns")).toBe(false)
    expect(v.resolveSectionOpen({}, "complete", "concerns")).toBe(true)
  })

  it("expand all / collapse all set every id, and the toggle label follows", async () => {
    const v = await import("./cv-generation-view")
    const ids = ["concerns", "brief"]
    expect(v.setAllSections(ids, true)).toEqual({ concerns: true, brief: true })
    expect(v.setAllSections(ids, false)).toEqual({ concerns: false, brief: false })
    expect(v.allSectionsOpen({}, "complete", ids)).toBe(false)
    expect(v.allSectionsOpen(v.setAllSections(ids, true), "writing", ids)).toBe(true)
    expect(v.allSectionsOpen({}, "complete", [])).toBe(false)
  })
})
