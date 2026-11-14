import type { ReactNode } from 'react'

/**
 * The document and details regions beside the notes list. From 1100px up each
 * region scrolls on its own and the header stays put; below that the regions
 * stack and the page scrolls.
 */
export function NoteFrame({ header, children, details, detailsLabel = 'Details' }: {
  /** Title and key facts: fixed above the scrolling document. */
  header: ReactNode
  /** The document body. */
  children: ReactNode
  details: ReactNode
  detailsLabel?: string
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0 min-[1100px]:flex-row">
      <section aria-label="Document" className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0">
        <div className="shrink-0 border-b">{header}</div>
        <div className="min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto">{children}</div>
      </section>
      <aside
        aria-label={detailsLabel}
        className="border-t min-[1100px]:min-h-0 min-[1100px]:w-80 min-[1100px]:shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-l min-[1100px]:border-t-0"
      >
        <div className="space-y-4 p-4">{details}</div>
      </aside>
    </div>
  )
}
