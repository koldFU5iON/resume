"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

/**
 * Save-first navigation for editors with unsaved work (#371).
 *
 * Editors register a guard while mounted. When the user leaves through a
 * same-origin link (tabs, document switcher, sidebar, header) or a
 * programmatic navigation that goes through `guardedNavigate`, each dirty
 * guard first settles its pending save. If one can't (the save failed, or the
 * document changed elsewhere) it asks before leaving. Reloads and closing the
 * tab fall back to the editors' beforeunload warnings, and the live editor
 * keeps a local recovery copy either way.
 */
export type NavigationGuard = {
  /** Cheap and synchronous: does leaving now need this guard at all? */
  isDirty: () => boolean
  /** Save what's pending; resolve true when it's fine to leave. May ask the user. */
  settle: () => Promise<boolean>
}

type Registration = NavigationGuard & { push: (href: string) => void }

const registrations = new Set<Registration>()

function dirtyGuards(): Registration[] {
  return [...registrations].filter(guard => guard.isDirty())
}

/** Resolves true when navigation may proceed. */
export async function confirmNavigation(): Promise<boolean> {
  for (const guard of dirtyGuards()) {
    if (!(await guard.settle())) return false
  }
  return true
}

/** Navigates once every dirty editor has saved, or the user chose to leave anyway. */
export async function guardedNavigate(navigate: () => void): Promise<boolean> {
  if (!(await confirmNavigation())) return false
  navigate()
  return true
}

/** The internal URL a click on this anchor would open in this tab, or null when it isn't one to hold. */
export function interceptableHref(
  anchor: Pick<HTMLAnchorElement, "getAttribute" | "hasAttribute">,
  event: Pick<MouseEvent, "defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  location: Pick<Location, "href" | "origin" | "pathname" | "search">,
): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const target = anchor.getAttribute("target")
  if ((target && target !== "_self") || anchor.hasAttribute("download")) return null
  const raw = anchor.getAttribute("href")
  if (!raw || raw.startsWith("#")) return null
  let url: URL
  try {
    url = new URL(raw, location.href)
  } catch {
    return null
  }
  if (url.origin !== location.origin) return null
  if (url.pathname === location.pathname && url.search === location.search) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** Set while a held click is being replayed, so the listener lets it through. */
let replaying = false

// One capture-phase listener on the document for all guards. It runs before
// Next's <Link> handler (React listens on the root), holds the click, and once
// every dirty guard has settled replays the same click on the same anchor, so
// the link's own onClick, replace and scroll options all still apply.
function onDocumentClick(event: MouseEvent) {
  if (replaying) return
  const dirty = dirtyGuards()
  if (dirty.length === 0) return
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null
  if (!(anchor instanceof HTMLAnchorElement)) return
  const href = interceptableHref(anchor, event, window.location)
  if (!href) return
  event.preventDefault()
  event.stopPropagation()
  const push = dirty[dirty.length - 1].push
  void confirmNavigation().then(ok => {
    if (!ok) return
    if (!anchor.isConnected) return push(href)
    replaying = true
    try {
      anchor.click()
    } finally {
      replaying = false
    }
  })
}

/** Registers `guard` while the calling editor is mounted. */
export function useNavigationGuard(guard: NavigationGuard) {
  const router = useRouter()
  const guardRef = useRef(guard)
  useEffect(() => {
    guardRef.current = guard
  })

  useEffect(() => {
    const registration: Registration = {
      isDirty: () => guardRef.current.isDirty(),
      settle: () => guardRef.current.settle(),
      push: href => router.push(href),
    }
    if (registrations.size === 0) document.addEventListener("click", onDocumentClick, { capture: true })
    registrations.add(registration)
    return () => {
      registrations.delete(registration)
      if (registrations.size === 0) document.removeEventListener("click", onDocumentClick, { capture: true })
    }
  }, [router])
}
