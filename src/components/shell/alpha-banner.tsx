'use client'

import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'

export const STORAGE_KEY = 'alpha-banner-dismissed'

// Dismissal lives in localStorage, which the server can't see. Reading it in
// render (or a useState initializer) makes the client's first render differ
// from the server HTML and React throws a hydration error. useSyncExternalStore
// uses getServerSnapshot (hidden) for the server and for hydration, then
// re-renders with the real value once mounted.

const listeners = new Set<() => void>()
// In-memory fallback so dismissing still works when storage throws (private windows).
let dismissedInMemory = false

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function isDismissed(): boolean {
  if (dismissedInMemory) return true
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return false
  }
}

export function dismissBanner() {
  dismissedInMemory = true
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage unavailable: the in-memory flag hides it for this page session.
  }
  listeners.forEach((l) => l())
}

const getSnapshot = () => !isDismissed()
const getServerSnapshot = () => false

export function AlphaBanner() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const dismiss = dismissBanner

  if (!visible) return null

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p>
        <strong>Currnt is in active development</strong> — things change frequently.
        Found a bug?{' '}
        <a
          href="https://github.com/koldFU5iON/currnt/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Submit an issue
        </a>
        . Enjoying it?{' '}
        <a
          href="https://buymeacoffee.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Buy me a coffee ☕
        </a>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
        aria-label="Dismiss banner"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
