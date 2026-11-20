'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { deleteExperience, getExperienceDeleteImpact } from '@/modules/profile/actions'
import type { ExperienceWithActivities } from '@/app/types/profile'

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
  // "Independent projects" is where kept projects live, so there is nowhere to keep them if it goes.
  const isIndependent = experience.type === 'independent'
  const [projectChoice, setProjectChoice] = useState<'keep' | 'delete'>(isIndependent ? 'delete' : 'keep')
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
              {!isIndependent && (
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="delete-projects"
                    className="mt-1"
                    checked={projectChoice === 'keep'}
                    onChange={() => setProjectChoice('keep')}
                  />
                  <span>Keep {plural(impact.projects, 'project')}, moved to Independent projects</span>
                </label>
              )}
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
