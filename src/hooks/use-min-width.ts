import * as React from "react"

/**
 * The width where the profile workspace goes from one column (notes list,
 * document, Details sheet) to three side by side. Tailwind cannot take a
 * constant: the `min-[1100px]` / `max-[1099px]` classes in profile/layout.tsx,
 * NotesNav.tsx and NoteFrame.tsx must match this number.
 */
export const PROFILE_WIDE_PX = 1100

/**
 * True while the viewport is at least `px` wide. On the server, and for the
 * first client render, it is true: the wide layout is what the page is
 * rendered as, and the narrow layout takes over after hydration (CSS hides
 * the wide pieces in the meantime, so nothing flashes).
 */
export function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`
  const subscribe = React.useCallback((callback: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener("change", callback)
    return () => mql.removeEventListener("change", callback)
  }, [query])
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true)
}
