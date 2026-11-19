'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createActivity, deleteActivity, updateActivity } from '@/modules/profile/actions'
import type { ExtractionOwner } from '@/modules/profile/extract'
import { noteHref } from '@/modules/profile/note-index'
import { combineImpact, parseResult } from '@/modules/profile/result'
import { RoleActivityKind } from '@/app/types/profile'
import type { RoleActivity, RoleActivityKindType } from '@/app/types/profile'
import { ExtractionPanel } from './ExtractionPanel'
import { selectClass } from './PropertyFields'

type Group = { id: string; name: string; activities: RoleActivity[] }

/** The result and the free-text outcome as readers (and the CV generator) see them. */
const shownImpact = (a: RoleActivity) => combineImpact(a.impact, parseResult(a.result))

const KIND_LABEL: Record<string, string> = {
  [RoleActivityKind.Achievement]: 'Achievement',
  [RoleActivityKind.Responsibility]: 'Responsibility',
}

/** Row actions show on hover, on focus, and always where there is no hover (touch). */
const ROW_ACTIONS = 'flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'

/**
 * The evidence a role or a project owns: read it, add to it, edit it, delete
 * it (after asking), and extract more from the note. A role also shows what
 * its projects own, read-only, each under a link to that project.
 */
export function EvidencePanel({ owner, activities: initial, skills, fromProjects = [] }: {
  owner: ExtractionOwner
  activities: RoleActivity[]
  skills: { id: string; name: string }[]
  fromProjects?: Group[]
}) {
  const noun = 'projectId' in owner ? 'project' : 'role'
  const [activities, setActivities] = useState(initial)
  // The server's list is the truth: follow it when a refresh brings a new one (extraction accepted, another tab).
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setActivities(initial)
  }

  const [editing, setEditing] = useState<RoleActivity | 'new' | null>(null)
  const [kind, setKind] = useState<RoleActivityKindType>(RoleActivityKind.Achievement)
  const [description, setDescription] = useState('')
  const [impact, setImpact] = useState('')
  const [resMeasure, setResMeasure] = useState('')
  const [resValue, setResValue] = useState('')
  const [resBaseline, setResBaseline] = useState('')
  const [resPeriod, setResPeriod] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<RoleActivity | null>(null)

  function openForm(activity: RoleActivity | 'new') {
    setEditing(activity)
    setKind(activity === 'new' ? RoleActivityKind.Achievement : activity.kind)
    setDescription(activity === 'new' ? '' : activity.description)
    setImpact(activity === 'new' ? '' : activity.impact ?? '')
    const result = activity === 'new' ? null : parseResult(activity.result)
    setResMeasure(result?.measure ?? '')
    setResValue(result?.value ?? '')
    setResBaseline(result?.baseline ?? '')
    setResPeriod(result?.period ?? '')
  }

  async function save() {
    if (!description.trim() || saving || !editing) return
    const filled = kind === RoleActivityKind.Achievement && [resMeasure, resValue, resBaseline, resPeriod].some(v => v.trim())
    if (filled && (!resMeasure.trim() || !resValue.trim())) {
      toast.error('A result needs what it measures and the figure.')
      return
    }
    const result = filled ? { measure: resMeasure, value: resValue, baseline: resBaseline, period: resPeriod } : null
    const data = { kind, description: description.trim(), impact: impact.trim() || undefined, result }
    setSaving(true)
    try {
      if (editing === 'new') {
        const created = await createActivity(owner, data)
        setActivities(prev => [...prev, { ...created, kind: created.kind as RoleActivityKindType, tags: [] }])
      } else {
        const updated = await updateActivity(editing.id, data)
        setActivities(prev => prev.map(a => (a.id === editing.id ? { ...updated, kind: updated.kind as RoleActivityKindType, tags: [] } : a)))
      }
      setEditing(null)
    } catch {
      toast.error('Could not save the evidence. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    const before = activities
    setActivities(prev => prev.filter(a => a.id !== target.id))
    try {
      await deleteActivity(target.id)
    } catch {
      setActivities(before)
      toast.error('Could not delete the evidence. It is still there.')
    }
  }

  const achievements = activities.filter(a => a.kind === RoleActivityKind.Achievement).length
  const responsibilities = activities.length - achievements

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Evidence</h2>
        <p className="text-xs text-muted-foreground">
          {activities.length === 0 ? 'None yet' : `${achievements} achievement${achievements === 1 ? '' : 's'} · ${responsibilities} responsibilit${responsibilities === 1 ? 'y' : 'ies'}`}
        </p>
      </div>

      {activities.length > 0 && (
        <ul className="space-y-1">
          {activities.map(activity => (
            <li key={activity.id} className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[activity.kind] ?? activity.kind}</p>
                <p className="text-sm leading-snug">{activity.description}</p>
                {shownImpact(activity) && <p className="mt-0.5 text-xs text-muted-foreground">↳ {shownImpact(activity)}</p>}
              </div>
              <div className={ROW_ACTIONS}>
                <Button variant="ghost" size="icon" className="size-7 max-md:size-11" onClick={() => openForm(activity)} aria-label={`Edit: ${activity.description.slice(0, 60)}`}>
                  <Pencil size={13} />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 max-md:size-11 hover:text-destructive" onClick={() => setDeleting(activity)} aria-label={`Delete: ${activity.description.slice(0, 60)}`}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <form
          className="space-y-2 rounded-md border p-3"
          onSubmit={event => { event.preventDefault(); void save() }}
        >
          <p className="text-sm font-medium">{editing === 'new' ? 'Add evidence' : 'Edit evidence'}</p>
          <div className="space-y-1">
            <Label htmlFor="evidence-kind" className="text-xs text-muted-foreground">Kind</Label>
            <select id="evidence-kind" className={selectClass} value={kind} onChange={e => setKind(e.target.value as RoleActivityKindType)}>
              <option value={RoleActivityKind.Achievement}>Achievement: a specific outcome</option>
              <option value={RoleActivityKind.Responsibility}>Responsibility: an ongoing duty</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="evidence-description" className="text-xs text-muted-foreground">What happened</Label>
            <Textarea id="evidence-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="evidence-impact" className="text-xs text-muted-foreground">Measurable outcome (optional)</Label>
            <Input className="max-md:h-11" id="evidence-impact" value={impact} onChange={e => setImpact(e.target.value)} placeholder="e.g. cut release time from 6 weeks to 2" />
          </div>
          {kind === RoleActivityKind.Achievement && (
            <fieldset className="space-y-2 rounded-md border border-dashed p-2">
              <legend className="px-1 text-xs text-muted-foreground">Result (optional): the figure, so the CV states it correctly</legend>
              <div className="space-y-1">
                <Label htmlFor="evidence-result-measure" className="text-xs text-muted-foreground">What it measures</Label>
                <Input className="max-md:h-11" id="evidence-result-measure" value={resMeasure} onChange={e => setResMeasure(e.target.value)} placeholder="e.g. asset turnaround time" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="evidence-result-value" className="text-xs text-muted-foreground">Result</Label>
                  <Input className="max-md:h-11" id="evidence-result-value" value={resValue} onChange={e => setResValue(e.target.value)} placeholder="e.g. 1 hour" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="evidence-result-baseline" className="text-xs text-muted-foreground">Started at</Label>
                  <Input className="max-md:h-11" id="evidence-result-baseline" value={resBaseline} onChange={e => setResBaseline(e.target.value)} placeholder="e.g. 3 weeks" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="evidence-result-period" className="text-xs text-muted-foreground">Period</Label>
                  <Input className="max-md:h-11" id="evidence-result-period" value={resPeriod} onChange={e => setResPeriod(e.target.value)} placeholder="e.g. Q3 2023" />
                </div>
              </div>
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" className="max-md:h-11" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" size="sm" className="max-md:h-11" disabled={saving || !description.trim()}>{saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}</Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="gap-1.5 max-md:h-11" onClick={() => openForm('new')}>
          <Plus size={13} aria-hidden="true" />
          Add evidence
        </Button>
      )}

      <ExtractionPanel owner={owner} existingActivities={activities} existingSkills={skills} />

      {fromProjects.filter(group => group.activities.length > 0).map(group => (
        <section key={group.id} aria-label={`Evidence from ${group.name}`} className="space-y-1 border-t pt-4">
          <h3 className="text-sm font-semibold">
            <Link href={noteHref(group.id)} className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-primary max-md:min-h-11">From {group.name}</Link>
          </h3>
          <p className="text-xs text-muted-foreground">Edit it on the project&apos;s own page.</p>
          <ul className="space-y-1 pt-1">
            {group.activities.map(activity => (
              <li key={activity.id} className="px-2 py-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[activity.kind] ?? activity.kind}</p>
                <p className="text-sm leading-snug">{activity.description}</p>
                {shownImpact(activity) && <p className="mt-0.5 text-xs text-muted-foreground">↳ {shownImpact(activity)}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <AlertDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this evidence?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.description.slice(0, 140)}{(deleting?.description.length ?? 0) > 140 ? '…' : ''}&rdquo; is removed from this {noun},
              together with any links it has to your capabilities. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-md:h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="max-md:h-11" onClick={() => void confirmDelete()}>Delete evidence</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
