/**
 * The one hook other pages use to open the coach with a message already typed
 * in its input. It never sends: the user reads, edits and sends it. It does not
 * touch the profile either. ChatPanel listens for the event and fills its draft.
 * Keep the coupling this thin: the coach is due a rework.
 */
export const COACH_DRAFT_EVENT = "coach-draft"

export type CoachDraftDetail = { text: string }

/** Open the coach with `text` as an unsent draft. No-op outside the browser or for empty text. */
export function openCoachWithDraft(text: string): void {
  const draft = text.trim()
  if (!draft || typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<CoachDraftDetail>(COACH_DRAFT_EVENT, { detail: { text: draft } }))
}
