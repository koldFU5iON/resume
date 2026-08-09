'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

type Props = {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  addLabel?: string
  compact?: boolean
}

// Textarea that grows with its content so a full bullet is always visible
// while editing, instead of being clipped inside a fixed single-line input.
function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      rows={1}
      className={cn(
        'w-full resize-none overflow-hidden text-sm outline-none focus:ring-1 focus:ring-ring',
        className,
      )}
    />
  )
}

function SortableItem({
  id,
  value,
  placeholder,
  onChange,
  onRemove,
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group/item flex gap-2 rounded-md border border-input bg-background px-3 py-1.5',
        isDragging && 'z-20 shadow-md',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="cursor-grab touch-none self-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        title="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="flex flex-1 items-center">
        <AutoGrowTextarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="border-none bg-transparent px-0 py-0.5"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="self-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Remove item"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

export function SortableItemList({
  items,
  onChange,
  placeholder,
  addLabel = 'Add',
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = Number(active.id)
    const newIndex = Number(over.id)
    if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return
    onChange(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
          {items.map((item, i) => (
            <SortableItem
              key={i}
              id={String(i)}
              value={item}
              placeholder={placeholder}
              onChange={value =>
                onChange(items.map((it, j) => (j === i ? value : it)))
              }
              onRemove={() => onChange(items.filter((_, j) => j !== i))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-3" />
        {addLabel}
      </button>
    </div>
  )
}