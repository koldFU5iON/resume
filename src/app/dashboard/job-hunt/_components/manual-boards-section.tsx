'use client'

import { useState, useTransition } from 'react'
import type { ManualJobBoard } from '@prisma/client'
import { ExternalLink, Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addManualBoard, removeManualBoard } from '@/modules/job-hunt/manual-boards/actions'

type Props = {
  boards: ManualJobBoard[]
}

function groupByCategory(boards: ManualJobBoard[]) {
  const map = new Map<string, ManualJobBoard[]>()
  for (const b of boards) {
    const existing = map.get(b.category)
    if (existing) existing.push(b)
    else map.set(b.category, [b])
  }
  return map
}

export function ManualBoardsSection({ boards }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [isPending, startTransition] = useTransition()

  const grouped = groupByCategory(boards)

  function handleAdd() {
    startTransition(async () => {
      const result = await addManualBoard({ category: category.trim(), name: name.trim(), url: url.trim() })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCategory('')
      setName('')
      setUrl('')
      setShowForm(false)
    })
  }

  function handleRemove(id: string, boardName: string) {
    startTransition(async () => {
      const result = await removeManualBoard(id)
      if (!result.ok) toast.error('Could not remove board')
      else toast.success(`Removed ${boardName}`)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Manual boards
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
          className="-my-1 flex items-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 pb-2">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (e.g. Gaming)"
            aria-label="Category"
            className="h-8 text-sm"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Hitmarker)"
            aria-label="Board name"
            className="h-8 text-sm"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (https://…)"
            aria-label="Board URL"
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleAdd}
              disabled={isPending || !category.trim() || !name.trim() || !url.trim()}
            >
              {isPending ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {boards.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">No boards added yet</p>
      )}

      {[...grouped.entries()].map(([cat, items]) => (
        <div key={cat}>
          <p className="text-xs text-muted-foreground mb-1">{cat}</p>
          <div>
            {items.map((board) => (
              <div key={board.id} className="flex items-center gap-1">
                <a
                  href={board.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 py-1 text-sm text-foreground hover:text-primary transition-colors flex-1 min-w-0"
                >
                  <span className="truncate">{board.name}</span>
                  <ExternalLink className="size-3 opacity-50 shrink-0" />
                </a>
                <button
                  onClick={() => handleRemove(board.id, board.name)}
                  disabled={isPending}
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  aria-label={`Remove ${board.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
