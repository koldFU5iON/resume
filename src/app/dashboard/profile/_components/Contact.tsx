'use client'

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  AlertTriangleIcon,
  Check,
  ExternalLink,
  Code2,
  Globe,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  X,
} from "lucide-react"
import { updateContactField, type ContactField } from "@/modules/profile/actions"

type ContactBlockProps = {
  phone?: string
  email?: string
  site?: string
  profile?: string
  github?: string
  location?: string
}

type EditableFieldProps = {
  icon: React.ReactNode
  field: ContactField
  value?: string
  label: string
  isLink?: boolean
}

function toHref(value: string) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `https://${value}`
}

function EditableField({ icon, field, value, label, isLink }: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(value)
  const [draft, setDraft] = useState(value ?? '')
  const [error, setError] = useState(false)

  const handleSave = async () => {
    setEditing(false)
    const prev = current
    setCurrent(draft.trim() || undefined)
    try {
      await updateContactField(field, draft)
    } catch {
      setCurrent(prev)
      setError(true)
      setTimeout(() => setError(false), 3000)
    }
  }

  const handleCancel = () => {
    setDraft(current ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      // onBlur on the container: save when focus leaves the whole edit group
      <div
        className="flex items-center gap-2 px-1 py-1"
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) handleSave()
        }}
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <Input
          className="h-7 text-sm py-0"
          value={draft}
          placeholder={label}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
        />
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={handleSave} aria-label="Save">
          <Check size={13} />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={handleCancel} aria-label="Cancel">
          <X size={13} />
        </Button>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex min-w-0 items-center gap-2 px-1 py-1.5 rounded cursor-pointer hover:bg-accent/60 transition-colors"
      onClick={() => setEditing(true)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
      aria-label={`Edit ${label}`}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>

      {/* External link button — shown for URL fields when a value exists */}
      {isLink && current && (
        <a
          href={toHref(current)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
          aria-label={`Open ${label}`}
          tabIndex={0}
        >
          <ExternalLink size={12} />
        </a>
      )}

      <div className="min-w-0 flex-1">
        {error
          ? <span className="text-xs text-destructive">Failed to save</span>
          : current
            ? (
              <span
                className="block truncate text-sm"
                title={current}
              >
                {current}
              </span>
            )
            : <AlertTriangleIcon size={14} className="text-amber-500" aria-label={`${label} not set`} />
        }
      </div>

      <Pencil size={11} className="ml-auto opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
    </div>
  )
}

export function ContactBlock({ contact }: { contact: ContactBlockProps }) {
  return (
    <div className="ml-2 mt-2 space-y-0.5">
      <EditableField icon={<Mail size={14} />} field="email" value={contact.email} label="Email" />
      <EditableField icon={<Phone size={14} />} field="phone" value={contact.phone} label="Phone" />
      <EditableField icon={<Link2 size={14} />} field="linkedIn" value={contact.profile} label="LinkedIn" isLink />
      <EditableField icon={<Code2 size={14} />} field="github" value={contact.github} label="GitHub" isLink />
      <EditableField icon={<Globe size={14} />} field="website" value={contact.site} label="Website" isLink />
      <EditableField icon={<MapPin size={14} />} field="location" value={contact.location} label="Location" />
    </div>
  )
}
