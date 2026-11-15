'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check, X, Download, FileJson, FileText } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEditableValue } from './use-editable-value'
import { updateContactField, type ContactField } from '@/modules/profile/actions'
import { ImportProfileDialog } from './ImportProfileDialog'

function ExportProfileDropdown() {
  function download(format: 'md' | 'json') {
    const a = document.createElement('a')
    a.href = `/api/profile/export?format=${format}`
    a.download = `profile.${format}`
    a.click()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="sm" variant="outline" className="gap-1.5 max-md:h-11">
          <Download className="size-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => download('md')}>
          <FileText className="size-3.5" />
          Markdown
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => download('json')}>
          <FileJson className="size-3.5" />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type EditableHeaderFieldProps = {
  field: ContactField
  value?: string
  placeholder: string
  className: string
}

function EditableHeaderField({ field, value, placeholder, className }: EditableHeaderFieldProps) {
  const { editing, setEditing, current, setCurrent, draft, setDraft } = useEditableValue(value)

  const handleSave = async () => {
    setEditing(false)
    const prev = current
    setCurrent(draft.trim() || undefined)
    try {
      await updateContactField(field, draft)
    } catch {
      setCurrent(prev)
    }
  }

  const handleCancel = () => {
    setDraft(current ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          className={`h-auto py-0.5 ${className}`}
          value={draft}
          placeholder={placeholder}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
        />
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleSave} aria-label="Save">
          <Check size={12} />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCancel} aria-label="Cancel">
          <X size={12} />
        </Button>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="group cursor-pointer rounded px-1 hover:bg-accent/60 transition-colors inline-flex items-center gap-1.5"
      onClick={() => setEditing(true)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
      aria-label={`Edit ${field}`}
    >
      {current
        ? <span className={className}>{current}</span>
        : <span className={`${className} text-muted-foreground/40`}>{placeholder}</span>
      }
    </div>
  )
}

type ProfileHeaderProps = {
  name: string
  headline?: string
}

export function ProfileHeader({ name, headline }: ProfileHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="space-y-0.5">
        <EditableHeaderField
          field="name"
          value={name}
          placeholder="Your name"
          className="text-2xl font-semibold"
        />
        <EditableHeaderField
          field="headline"
          value={headline}
          placeholder="Add a professional headline…"
          className="text-sm text-muted-foreground"
        />
      </div>
      <div className="shrink-0 mt-1 flex items-center gap-2">
        <ExportProfileDropdown />
        <ImportProfileDialog />
      </div>
    </div>
  )
}
