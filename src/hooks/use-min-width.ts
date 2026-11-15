import * as React from "react"

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
