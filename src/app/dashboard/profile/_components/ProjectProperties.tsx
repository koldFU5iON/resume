'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import type { FullProfile } from '@/app/types/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteProject, updateProjectProperties } from '@/modules/profile/actions'
import { noteHref, overviewHref } from '@/modules/profile/note-index'
import { ProjectPropertiesSchema } from '@/modules/profile/properties-schema'
import { PropertiesStatus, PropertyRow, selectClass, toDateInput } from './PropertyFields'
import { useFieldSaver } from './use-field-saver'

/**
 * A project's facts, saved as you leave each field. "Part of" moves it to
 * another role (or to none); its evidence belongs to the project, so it goes
 * along, and the note keeps its address.
 */
export function ProjectProperties({ project, roles }: {
  project: FullProfile['projects'][number]
  /** Every role the project could be part of. */
  roles: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const form = useFieldSaver(
    {
      name: project.name,
      description: project.description,
      experienceId: project.experienceId,
      url: project.url ?? '',
      repoUrl: project.repoUrl ?? '',
      startDate: toDateInput(project.startDate),
      endDate: toDateInput(project.endDate),
    },
    ProjectPropertiesSchema,
    async values => {
      await updateProjectProperties(project.id, values)
      router.refresh()
    },
  )
  const { values, set, commit, problems } = form
  const text = (name: 'name' | 'url' | 'repoUrl') => ({
    id: `project-${name}`,
    value: (values[name] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(name, e.target.value),
    onBlur: commit,
    'aria-invalid': problems[name] ? true : undefined,
    'aria-describedby': problems[name] ? `project-${name}-problem` : undefined,
  })

  async function confirmDelete() {
    setDeleteError(null)
    try {
      await deleteProject(project.id)
      setDeleteOpen(false)
      router.push(project.experienceId ? noteHref(project.experienceId) : overviewHref())
      router.refresh()
    } catch {
      setDeleteError('Could not delete the project. Nothing was removed; try again.')
    }
  }

  const evidenceCount = project.activities?.length ?? 0

  return (
    <>
      <div className="space-y-3">
        <PropertyRow id="project-name" label="Name" problem={problems.name}><Input {...text('name')} /></PropertyRow>
        <PropertyRow id="project-part-of" label="Part of">
          <select
            id="project-part-of"
            className={selectClass}
            value={values.experienceId ?? ''}
            onChange={e => { set('experienceId', e.target.value || null); commit() }}
          >
            <option value="">No role (a project of its own)</option>
            {roles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
          </select>
        </PropertyRow>
        <PropertyRow id="project-description" label="Description" problem={problems.description}>
          <Textarea
            id="project-description"
            rows={3}
            value={values.description as string}
            onChange={e => set('description', e.target.value)}
            onBlur={commit}
            placeholder="One or two lines: what it is and your part in it"
          />
        </PropertyRow>
        <PropertyRow id="project-url" label="Live URL" problem={problems.url}><Input {...text('url')} type="url" placeholder="https://…" /></PropertyRow>
        <PropertyRow id="project-repoUrl" label="Repository URL" problem={problems.repoUrl}><Input {...text('repoUrl')} type="url" placeholder="https://github.com/…" /></PropertyRow>
        <div className="grid grid-cols-2 gap-3">
          <PropertyRow id="project-start" label="Start date" problem={problems.startDate}>
            <Input id="project-start" type="date" value={values.startDate as string} onChange={e => set('startDate', e.target.value)} onBlur={commit} />
          </PropertyRow>
          <PropertyRow id="project-end" label="End date" problem={problems.endDate}>
            <Input id="project-end" type="date" value={values.endDate as string} onChange={e => set('endDate', e.target.value)} onBlur={commit} aria-invalid={problems.endDate ? true : undefined} />
          </PropertyRow>
        </div>
        <PropertiesStatus status={form.status} failure={form.failure} />
      </div>

      <div className="border-t pt-4">
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { setDeleteError(null); setDeleteOpen(true) }}>
          <Trash2 size={13} aria-hidden="true" />
          Delete this project…
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project and its notes
              {evidenceCount > 0 ? `, and its ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} with their links to capabilities` : ''}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={e => { e.preventDefault(); void confirmDelete() }}>Delete project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
