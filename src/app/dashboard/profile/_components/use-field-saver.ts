'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ZodType } from 'zod'

export type FieldStatus = 'idle' | 'saving' | 'saved' | 'error'

const same = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).every(key => a[key] === b[key])

/**
 * Properties save as you go: a field is committed when you leave it (or pick
 * a value), not on every keystroke. Checks the values with the same schema the
 * server enforces and says which field is wrong; a value that is not valid is
 * kept on screen and not sent. Saves are sent one at a time, in order.
 *
 * Unmounting commits too (the form can disappear mid-edit: the details switch
 * between a column and a sheet, or the sheet closes), and a failed save is
 * also shown as a toast, since the form that would show it may be gone.
 */
export function useFieldSaver<T extends Record<string, string | boolean | null>>(
  initial: T,
  schema: ZodType,
  save: (values: T) => Promise<void>,
) {
  const [values, setValues] = useState(initial)
  const [status, setStatus] = useState<FieldStatus>('idle')
  /** Field name → why it is not valid. */
  const [problems, setProblems] = useState<Partial<Record<keyof T, string>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(initial)
  const saved = useRef(initial)
  /** The values last sent (or saved), so leaving a field twice does not send twice. */
  const sent = useRef(initial)
  const queue = useRef<Promise<void>>(Promise.resolve())

  function set<K extends keyof T>(field: K, value: T[K]) {
    latest.current = { ...latest.current, [field]: value }
    setValues(latest.current)
  }

  /** Sends the current values if they are valid and differ from what is saved. */
  function commit() {
    const snapshot = latest.current
    const parsed = schema.safeParse(snapshot)
    if (!parsed.success) {
      const next: Partial<Record<keyof T, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof T
        if (field && !next[field]) next[field] = issue.message
      }
      setProblems(next)
      return
    }
    setProblems({})
    if (same(snapshot, sent.current)) return
    sent.current = snapshot
    setStatus('saving')
    setFailure(null)
    queue.current = queue.current.then(async () => {
      try {
        await save(snapshot)
        saved.current = snapshot
        setStatus('saved')
      } catch {
        sent.current = saved.current
        toast.error("Couldn't save your changes. Check your connection and try again.", { id: 'properties-save-failed' })
        setStatus('error')
        setFailure("Couldn't save. Your changes are still here; check your connection and leave the field again to retry.")
      }
    })
  }

  // The server's values are the truth: when they change (a save landed, or this form was
  // just remounted ahead of a save from the one it replaced), fields you have not touched
  // follow them. Fields you are editing keep what you typed.
  const seenInitial = useRef(initial)
  useEffect(() => {
    const previous = seenInitial.current
    if (same(previous, initial)) return
    seenInitial.current = initial
    const next = { ...latest.current }
    for (const key of Object.keys(initial) as (keyof T)[]) {
      if (latest.current[key] === previous[key]) next[key] = initial[key]
    }
    if (sent.current === saved.current) sent.current = initial
    saved.current = initial
    latest.current = next
    setValues(next)
  }, [initial])

  // Whatever is on screen when the form goes away still gets saved. The ref keeps
  // this on the latest commit (its save and schema) rather than the first render's.
  const commitRef = useRef(commit)
  useEffect(() => { commitRef.current = commit })
  useEffect(() => () => commitRef.current(), [])

  return { values, set, commit, status, problems, failure }
}
