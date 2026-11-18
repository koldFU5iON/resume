import { describe, expect, it } from "vitest"
import { StageLogEntrySchema, type CvGenerationStatus, type StageLogEntry } from "@/modules/cv-generation/schema"
import {
  buildStageRows,
  cvGenerationHref,
  cvGenerationSignature,
  formatCost,
  formatDuration,
  formatTokens,
  isCvGenerationActive,
  stageIndex,
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
