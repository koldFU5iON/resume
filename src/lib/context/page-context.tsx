'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import type { PageContext } from '@/modules/chat/schema'

type PageContextValue = {
  context: PageContext | null
  chatOpen: boolean
  setContext: (ctx: PageContext | null) => void
  clearContext: () => void
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  /** Command palette (Search or jump to…, Cmd/Ctrl+K). */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean | ((open: boolean) => boolean)) => void
  /** Quick add job dialog. */
  addJobOpen: boolean
  setAddJobOpen: (open: boolean) => void
}

const PageContextCtx = createContext<PageContextValue | null>(null)

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<PageContext | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [addJobOpen, setAddJobOpen] = useState(false)

  const setContext = useCallback((ctx: PageContext | null) => setContextState(ctx), [])
  const clearContext = useCallback(() => setContextState(null), [])
  const openPanel = useCallback(() => setChatOpen(true), [])
  const closePanel = useCallback(() => setChatOpen(false), [])
  const togglePanel = useCallback(() => setChatOpen(v => !v), [])

  return (
    <PageContextCtx.Provider
      value={{
        context, chatOpen, setContext, clearContext, openPanel, closePanel, togglePanel,
        paletteOpen, setPaletteOpen, addJobOpen, setAddJobOpen,
      }}
    >
      {children}
    </PageContextCtx.Provider>
  )
}

export function usePageContext(): PageContextValue {
  const ctx = useContext(PageContextCtx)
  if (!ctx) throw new Error('usePageContext must be used inside PageContextProvider')
  return ctx
}

export function useWorkspaceContext(ctx: PageContext | null) {
  const { setContext, clearContext } = usePageContext()
  useEffect(() => {
    if (ctx) setContext(ctx)
    return () => clearContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ctx)])
}
