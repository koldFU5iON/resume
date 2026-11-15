'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type DetailsTab = {
  id: string
  label: string
  /** Shown beside the label, e.g. how many evidence items. */
  count?: string
  panel: ReactNode
}

/**
 * Tabs as the ARIA Authoring Practices describe them: a tablist with one tab
 * stop, Left/Right (wrapping) and Home/End to move, and the panel following
 * the focused tab. Only the selected panel is shown, but all stay mounted so
 * an unsaved form in one is not lost when you look at another.
 */
export function DetailsTabs({ label, tabs, initial }: { label: string; tabs: DetailsTab[]; initial?: string }) {
  const base = useId()
  const [selected, setSelected] = useState(initial && tabs.some(t => t.id === initial) ? initial : tabs[0].id)
  const refs = useRef(new Map<string, HTMLButtonElement>())

  function move(to: number) {
    const tab = tabs[(to + tabs.length) % tabs.length]
    setSelected(tab.id)
    refs.current.get(tab.id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex(t => t.id === selected)
    const next =
      event.key === 'ArrowRight' ? at + 1
      : event.key === 'ArrowLeft' ? at - 1
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : null
    if (next === null) return
    event.preventDefault()
    move(next)
  }

  const tabId = (id: string) => `${base}-tab-${id}`
  const panelId = (id: string) => `${base}-panel-${id}`

  return (
    <div className="flex min-h-full flex-col">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="sticky top-0 z-10 flex shrink-0 gap-1 border-b bg-background px-2">
        {tabs.map(tab => {
          const active = tab.id === selected
          return (
            <button
              key={tab.id}
              ref={el => { if (el) refs.current.set(tab.id, el); else refs.current.delete(tab.id) }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(tab.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              className={cn(
                '-mb-px flex min-h-10 items-baseline gap-1.5 max-md:min-h-11 max-md:items-center border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
            </button>
          )
        })}
      </div>
      {tabs.map(tab => (
        <div
          key={tab.id}
          id={panelId(tab.id)}
          role="tabpanel"
          aria-labelledby={tabId(tab.id)}
          tabIndex={0}
          hidden={tab.id !== selected}
          className="space-y-4 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
