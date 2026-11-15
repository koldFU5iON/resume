'use client'

import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { PanelRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useMinWidth } from '@/hooks/use-min-width'

/**
 * The document and details regions beside the notes list. From 1100px up each
 * region scrolls on its own and the header stays put, with Details as a column
 * on the right. Below that the document is the page, and Details opens from a
 * button in the header: a bottom sheet on a phone, a side sheet on a tablet.
 * The details are rendered once, in whichever of those is showing.
 */
export function NoteFrame({ header, children, details, detailsLabel = 'Details' }: {
  /** Title and key facts: fixed above the scrolling document. */
  header: ReactNode
  /** The document body. */
  children: ReactNode
  details: ReactNode
  detailsLabel?: string
}) {
  const wide = useMinWidth(1100)
  const phone = useIsMobile()
  const pathname = usePathname()
  // Open for one address only: moving to another note (a link inside the sheet) closes it.
  const [openAt, setOpenAt] = useState<string | null>(null)

  return (
    <div className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0 min-[1100px]:flex-row">
      <section aria-label="Document" className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0">
        <div className="flex shrink-0 items-start gap-2 border-b">
          <div className="min-w-0 flex-1">{header}</div>
          <Button
            variant="outline"
            className="m-3 min-h-11 shrink-0 gap-1.5 min-[1100px]:hidden"
            aria-haspopup="dialog"
            onClick={() => setOpenAt(pathname)}
          >
            <PanelRight size={14} aria-hidden="true" />
            Details
          </Button>
        </div>
        <div className="min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:overflow-y-auto">{children}</div>
      </section>

      {wide ? (
        <aside
          aria-label={detailsLabel}
          className="border-t max-[1099px]:hidden min-[1100px]:min-h-0 min-[1100px]:w-80 min-[1100px]:shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-l min-[1100px]:border-t-0"
        >
          {details}
        </aside>
      ) : (
        <Sheet
          open={openAt === pathname}
          onOpenChange={open => {
            // Leaving a field by closing the sheet must still save it: blur first.
            if (!open) (document.activeElement as HTMLElement | null)?.blur?.()
            setOpenAt(open ? pathname : null)
          }}
        >
          <SheetContent
            side={phone ? 'bottom' : 'right'}
            showCloseButton={false}
            className="max-md:max-h-[88dvh] max-md:rounded-t-xl sm:max-w-md"
          >
            <SheetHeader className="flex-row items-center justify-between border-b py-2 pl-4 pr-2">
              <SheetTitle>{detailsLabel}</SheetTitle>
              <SheetClose render={<Button variant="ghost" className="size-11" />}>
                <X size={16} aria-hidden="true" />
                <span className="sr-only">Close</span>
              </SheetClose>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{details}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
