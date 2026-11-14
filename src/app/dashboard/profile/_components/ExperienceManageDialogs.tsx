'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { deleteExperience, getExperienceDeleteImpact, updateExperienceDetails } from '@/modules/profile/actions'
import type { ExperienceWithActivities } from '@/app/types/profile'

type EditData = {
  company: string
  role: string
  location?: string
  remote: boolean
  startDate: Date
  endDate?: Date
}

const toInputDate = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().split('T')[0] : ''

export function EditExperienceDialog({
  experience,
  open,
  onOpenChange,
  onSaved,
}: {
  experience: ExperienceWithActivities
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: (data: EditData) => void
}) {
  const [remote, setRemote] = useState(experience.remote)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const endDateStr = fd.get('endDate') as string
    const data: EditData = {
      company: fd.get('company') as string,
      role: fd.get('role') as string,
      location: (fd.get('location') as string) || undefined,
      remote,
      startDate: new Date(fd.get('startDate') as string),
      endDate: endDateStr ? new Date(endDateStr) : undefined,
    }
    setSaving(true)
    try {
      await updateExperienceDetails(experience.id, data)
      onSaved(data)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Experience</DialogTitle>
          <DialogDescription>Update the details for this role.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="edit-company">Company</Label>
                <Input id="edit-company" name="company" required defaultValue={experience.company} />
              </Field>
              <Field>
                <Label htmlFor="edit-role">Role / Title</Label>
                <Input id="edit-role" name="role" required defaultValue={experience.role} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  name="location"
                  placeholder="City, Country"
                  defaultValue={experience.location ?? ''}
                />
              </Field>
              <Field>
                <div className="mt-6 flex items-center gap-2">
                  <Checkbox
                    id="edit-remote"
                    checked={remote}
                    onCheckedChange={checked => setRemote(!!checked)}
                  />
                  <Label htmlFor="edit-remote">Remote position</Label>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="edit-start">Start Date</Label>
                <Input
                  id="edit-start"
                  name="startDate"
                  type="date"
                  required
                  defaultValue={toInputDate(experience.startDate)}
                />
              </Field>
              <Field>
                <Label htmlFor="edit-end">End Date</Label>
                <Input
                  id="edit-end"
                  name="endDate"
                  type="date"
                  defaultValue={toInputDate(experience.endDate)}
                />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary">Cancel</Button>} />
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type DeleteImpact = Awaited<ReturnType<typeof getExperienceDeleteImpact>>

export function DeleteExperienceDialog({
  experience,
  open,
  onOpenChange,
  onDeleted,
}: {
  experience: ExperienceWithActivities
  open: boolean
  onOpenChange: (o: boolean) => void
  onDeleted: (projects: 'keep' | 'delete') => void
}) {
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectChoice, setProjectChoice] = useState<'keep' | 'delete'>('keep')
  // Counts come from the database, not client state: the server deletes what it holds.
  const [impact, setImpact] = useState<DeleteImpact | null>(null)
  const target = experience.company
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getExperienceDeleteImpact(experience.id)
      .then(result => { if (!cancelled) setImpact(result) })
      .catch(() => { if (!cancelled) setError('Could not check what this role contains. Close and try again.') })
    return () => { cancelled = true }
  }, [open, experience.id])

  async function handleDelete() {
    if (typed !== target || !impact) return
    setDeleting(true)
    setError(null)
    try {
      await deleteExperience(experience.id, { projects: projectChoice })
      onDeleted(projectChoice)
    } catch {
      setError('Failed to delete this experience. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setTyped(''); onOpenChange(v) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {target}?</DialogTitle>
          <DialogDescription>
            This will permanently remove this work experience, its notes, and its{' '}
            {impact ? plural(impact.evidence, 'evidence item') : 'evidence'}. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {impact && impact.projects > 0 && (
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 text-muted-foreground">
                This role has {plural(impact.projects, 'project')}.
              </legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete-projects"
                  className="mt-1"
                  checked={projectChoice === 'keep'}
                  onChange={() => setProjectChoice('keep')}
                />
                <span>Keep {plural(impact.projects, 'project')} as standalone</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete-projects"
                  className="mt-1"
                  checked={projectChoice === 'delete'}
                  onChange={() => setProjectChoice('delete')}
                />
                <span>
                  Delete them too
                  {impact.projectEvidence > 0 && ` (and their ${plural(impact.projectEvidence, 'evidence item')})`}
                </span>
              </label>
            </fieldset>
          )}
          <p className="text-sm text-muted-foreground">
            Type{' '}
            <span className="font-semibold text-foreground">{target}</span>
            {' '}to confirm.
          </p>
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={target}
            onPaste={e => e.preventDefault()}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-2">
          <DialogClose render={<Button type="button" variant="secondary">Cancel</Button>} />
          <Button
            variant="destructive"
            disabled={typed !== target || deleting || !impact}
            onClick={handleDelete}
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
