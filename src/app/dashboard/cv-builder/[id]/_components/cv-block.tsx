'use client'

import { createContext, useContext, useState } from 'react'
import { Eye, EyeOff, Copy, Pencil, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { CVSection } from '@/modules/cv/schema'

// Blocks consume this to respond when the Edit button in the control bar is clicked.
// Each CvBlock provides its own value, so only the hovered block's child enters edit mode.
export const BlockEditTrigger = createContext<number>(0)

export function useBlockEditTrigger() {
  return useContext(BlockEditTrigger)
}

type Props = {
  section: CVSection
  onToggleVisibility: () => void
  onCopy: () => void
  children: React.ReactNode
}

export function CvBlock({ section, onToggleVisibility, onCopy, children }: Props) {
  const [editTrigger, setEditTrigger] = useState(0)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  if (!section.visible) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="group flex items-center justify-between border-b border-border/30 px-[15mm] py-2.5 opacity-40 last:border-b-0 print:hidden"
      >
        <span className="text-xs italic text-muted-foreground capitalize">
          {section.type} — hidden
        </span>
        <button
          onClick={onToggleVisibility}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
        >
          <Eye className="size-3" />
          Show
        </button>
      </div>
    )
  }

  return (
    <BlockEditTrigger.Provider value={editTrigger}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'cv-document-block group relative border-b border-border/30 px-[15mm] last:border-b-0 hover:bg-muted/20 print:hover:bg-transparent',
          section.type === 'certification' ? 'py-1.5' : 'py-3',
          isDragging && 'z-20 bg-background shadow-md',
        )}
      >
        {/* Controls — Drag / Edit / Copy / Hide, shown together on hover (always visible on mobile) */}
        <div className="absolute right-3 top-2.5 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 print:hidden">
          <button
            {...attributes}
            {...listeners}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="size-3" />
          </button>
          <button
            onClick={() => setEditTrigger(t => t + 1)}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Edit section"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={onCopy}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Copy section"
          >
            <Copy className="size-3" />
          </button>
          <button
            onClick={onToggleVisibility}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Hide section"
          >
            <EyeOff className="size-3" />
          </button>
        </div>

        {children}
      </div>
    </BlockEditTrigger.Provider>
  )
}
