import { startResponseMessage } from "./cv-generation-view"

/** What starting a CV generation led to. `draft_exists`: the job's CV document already has a draft waiting. */
export type StartOutcome =
  | { kind: "started"; existing: boolean }
  | { kind: "draft_exists"; documentId: string | null }
  | { kind: "error"; message: string }

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, "status" | "json">>

/**
 * POST /api/jobs/[id]/cv-generation. `fresh` re-selects evidence instead of
 * reusing the stored brief and selection; without it the body is empty (the
 * default reuse). The API answers 409 before any spend, so a draft_exists
 * outcome has cost nothing.
 */
export async function requestCvGeneration(jobId: string, options: { fresh?: boolean } = {}, doFetch: Fetch = fetch): Promise<StartOutcome> {
  try {
    const res = await doFetch(`/api/jobs/${encodeURIComponent(jobId)}/cv-generation`, {
      method: "POST",
      ...(options.fresh ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fresh: true }) } : {}),
    })
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { documentId?: unknown } | null
      return { kind: "draft_exists", documentId: typeof body?.documentId === "string" ? body.documentId : null }
    }
    const outcome = startResponseMessage(res.status)
    if (!outcome.ok) return { kind: "error", message: outcome.message ?? "Couldn't start the CV generation." }
    return { kind: "started", existing: res.status === 200 }
  } catch {
    return { kind: "error", message: startResponseMessage(0).message ?? "Couldn't start the CV generation." }
  }
}

/**
 * The "Discard draft" choice after a 409: discard the waiting draft (the
 * writing desk's own action), then start the run. A failed discard starts
 * nothing; a draft that is already gone counts as discarded.
 */
export async function discardDraftThenStart(
  jobId: string,
  documentId: string,
  options: { fresh?: boolean },
  deps: { discard: (documentId: string) => Promise<{ ok: boolean; reason?: string; message?: string }>; fetch?: Fetch },
): Promise<StartOutcome> {
  try {
    const discarded = await deps.discard(documentId)
    // A draft that is already gone (discarded in another tab) is what the user wanted: go on.
    if (!discarded.ok && discarded.reason !== "no_draft") return { kind: "error", message: discarded.message ?? "Couldn't discard the draft." }
  } catch {
    return { kind: "error", message: "Couldn't discard the draft. Try again." }
  }
  return requestCvGeneration(jobId, options, deps.fetch)
}
