'use client'

import { useState } from 'react'

/**
 * State for a field that is saved on its own and edited in place. `current` is
 * the saved value and follows the server whenever it changes; `draft` is what
 * is in the input and follows it only while the field is not being edited, so
 * typing is never overwritten and Escape (draft back to `current`) restores the
 * latest saved value, not the one from when editing began.
 */
export function useEditableValue(value: string | undefined) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(value)
  const [draft, setDraft] = useState(value ?? '')
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setCurrent(value)
    if (!editing) setDraft(value ?? '')
  }
  return { editing, setEditing, current, setCurrent, draft, setDraft }
}
