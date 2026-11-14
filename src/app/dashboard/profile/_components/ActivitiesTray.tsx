'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  createActivity, updateActivity, deleteActivity,
} from '@/modules/profile/actions'
import { RoleActivityKind } from '@/app/types/profile'
import type { RoleActivity, RoleActivityKindType } from '@/app/types/profile'
import { cn } from '@/lib/utils'

type Props = {
  experienceId: string
  initialActivities: RoleActivity[]
}

export function ActivitiesTray({ experienceId, initialActivities }: Props) {
  const [activities, setActivities] = useState(initialActivities)
  const [expanded, setExpanded] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [editing, setEditing] = useState<RoleActivity | null>(null)
  const [kind, setKind] = useState<RoleActivityKindType>(RoleActivityKind.Responsibility)
  const [description, setDescription] = useState('')
  const [impact, setImpact] = useState('')
  const [saving, setSaving] = useState(false)

  const responsibilities = activities.filter(a => a.kind === RoleActivityKind.Responsibility)
  const achievements = activities.filter(a => a.kind === RoleActivityKind.Achievement)

  function openAdd() {
    setEditing(null)
    setKind(RoleActivityKind.Responsibility)
    setDescription('')
    setImpact('')
    setFormVisible(true)
    setExpanded(true)
  }

  function openEdit(a: RoleActivity) {
    setEditing(a)
    setKind(a.kind)
    setDescription(a.description)
    setImpact(a.impact ?? '')
    setFormVisible(true)
    setExpanded(true)
  }

  function closeForm() {
    setFormVisible(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!description.trim() || saving) return
    setSaving(true)
    const data = { kind, description: description.trim(), impact: impact.trim() || undefined }
    try {
      if (editing) {
        const updated = await updateActivity(editing.id, data)
        const updatedActivity: RoleActivity = {
          ...updated,
          kind: updated.kind as RoleActivityKindType,
          tags: [],
        }
        setActivities(prev =>
          prev.map(a => a.id === editing.id ? updatedActivity : a)
        )
      } else {
        const created = await createActivity({ experienceId }, data)
        const newActivity: RoleActivity = {
          ...created,
          kind: created.kind as RoleActivityKindType,
          tags: [],
        }
        setActivities(prev => [...prev, newActivity])
      }
      closeForm()
    } catch {
      toast.error('Failed to save activity. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const prev = activities
    setActivities(prev => prev.filter(a => a.id !== id))
    try { await deleteActivity(id) } catch { setActivities(prev) }
  }

  return (
    <div className="shrink-0 border-t">
      {/* Header row — always visible */}
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/50"
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(v => !v)
          }
        }}
        aria-expanded={expanded}
        aria-label="Toggle activities"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activities
        </span>
        {responsibilities.length > 0 && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-400">
            {responsibilities.length}R
          </span>
        )}
        {achievements.length > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
            {achievements.length}A
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/dashboard/profile/experience/${experienceId}`}
            className="text-[10px] text-primary/70 hover:text-primary"
            onClick={e => e.stopPropagation()}
          >
            ✦ Extract
          </Link>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="space-y-0.5 px-3 pb-3">
          {activities.map(a => (
            <ActivityRow
              key={a.id}
              activity={a}
              onEdit={() => openEdit(a)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}

          {activities.length === 0 && !formVisible && (
            <p className="py-2 text-center text-xs text-muted-foreground">No activities yet.</p>
          )}

          {formVisible ? (
            <div className="mt-2 space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {editing ? 'Edit Activity' : 'New Activity'}
                </span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={closeForm}>
                  <X size={11} />
                </Button>
              </div>
              <Select value={kind} onValueChange={v => setKind(v as RoleActivityKindType)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={RoleActivityKind.Responsibility}>Responsibility</SelectItem>
                  <SelectItem value={RoleActivityKind.Achievement}>Achievement</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What did you do?"
                className="text-xs"
              />
              <Input
                value={impact}
                onChange={e => setImpact(e.target.value)}
                placeholder="Measurable outcome (optional)"
                className="h-7 text-xs"
              />
              <div className="flex justify-end gap-1">
                <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={closeForm}>
                  Cancel
                </Button>
                <Button size="sm" className="h-6 text-xs" onClick={handleSave} disabled={saving}>
                  {editing ? 'Save' : 'Add'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-6 w-full gap-1 text-xs"
              onClick={openAdd}
            >
              <Plus size={10} /> Add Activity
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityRow({
  activity,
  onEdit,
  onDelete,
}: {
  activity: RoleActivity
  onEdit: () => void
  onDelete: () => void
}) {
  const isAchievement = activity.kind === RoleActivityKind.Achievement
  return (
    <div className="group flex items-start gap-1.5 rounded px-1 py-1 hover:bg-muted/50">
      <div
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          isAchievement ? 'bg-amber-400' : 'bg-green-400',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed">{activity.description}</p>
        {activity.impact && (
          <p className="text-[10px] text-muted-foreground">↳ {activity.impact}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onEdit} aria-label="Edit activity">
          <Pencil size={9} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete activity"
        >
          <Trash2 size={9} />
        </Button>
      </div>
    </div>
  )
}
