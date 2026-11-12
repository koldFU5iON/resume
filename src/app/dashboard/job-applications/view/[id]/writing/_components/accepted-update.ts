/**
 * What the open editor does when a draft for its document is accepted
 * elsewhere (the Coach card, or the draft review) (#378). Pure, so the rules
 * are unit-tested; the editor settles its in-flight save before asking.
 *
 * The accepted text is already the saved version on the server. Unsaved
 * local edits are never thrown away for it: they stay in the editor (and in
 * the device's recovery copy) and the user compares the two versions.
 */

export type SavedVersion = { content: string; revision: number }

export type EditorSnapshot = {
  /** The text the editor shows. */
  content: string
  /** The saved revision the editor's text builds on. */
  revision: number
  /** Edited text not yet saved, or null. */
  pending: string | null
  /** The newer saved version the editor is already in conflict with, or null. */
  conflict: SavedVersion | null
}

export type AcceptedUpdatePlan =
  /** The editor's text already builds on this revision or a newer one: a stale or repeated event. */
  | { kind: "ignore" }
  /** Nothing unsaved (or the unsaved text is what was accepted): show the accepted text as saved. */
  | { kind: "apply" }
  /** Unsaved edits differ from the accepted text: keep them and compare with `compareWith`. */
  | { kind: "conflict"; compareWith: SavedVersion }

/** Of two saved versions, the newer; the later argument wins a tie. */
export function newerSavedVersion(current: SavedVersion | null, next: SavedVersion): SavedVersion {
  return current && current.revision > next.revision ? current : next
}

export function planAcceptedUpdate(editor: EditorSnapshot, accepted: SavedVersion): AcceptedUpdatePlan {
  if (accepted.revision <= editor.revision) return { kind: "ignore" }
  const unsaved = editor.pending !== null || editor.conflict !== null
  if (!unsaved || editor.content === accepted.content) return { kind: "apply" }
  return { kind: "conflict", compareWith: newerSavedVersion(editor.conflict, accepted) }
}
