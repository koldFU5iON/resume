'use client'

import { useRef, useState } from 'react'
import type { ZodType } from 'zod'

export type FieldStatus = 'idle' | 'saving' | 'saved' | 'error'

const same = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).every(key => a[key] === b[key])

/**
 * Properties save as you go: a field is committed when you leave it (or pick
 * a value), not on every keystroke. Checks the values with the same schema the
 * server enforces and says which field is wrong; a value that is not valid is
 * kept on screen and not sent. Saves are sent one at a time, in order.
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
    if (same(snapshot, saved.current)) return
    setStatus('saving')
    setFailure(null)
    queue.current = queue.current.then(async () => {
      try {
        await save(snapshot)
        saved.current = snapshot
        setStatus('saved')
      } catch {
        setStatus('error')
        setFailure("Couldn't save. Your changes are still here; check your connection and leave the field again to retry.")
      }
    })
  }

  return { values, set, commit, status, problems, failure }
}
