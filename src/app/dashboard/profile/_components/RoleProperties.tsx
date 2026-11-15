'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import type { FullProfile } from '@/app/types/profile'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { updateExperienceProperties } from '@/modules/profile/actions'
import { overviewHref } from '@/modules/profile/note-index'
import { ExperiencePropertiesSchema } from '@/modules/profile/properties-schema'
import { DeleteExperienceDialog } from './DeleteExperienceDialog'
import { PropertiesStatus, PropertyRow, toDateInput } from './PropertyFields'
import { useFieldSaver } from './use-field-saver'

/** A role's facts, saved as you leave each field, plus deleting the role. */
export function RoleProperties({ experience }: { experience: FullProfile['experiences'][number] }) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const form = useFieldSaver(
    {
      company: experience.company,
      role: experience.role,
      location: experience.location ?? '',
      remote: experience.remote,
      startDate: toDateInput(experience.startDate),
      endDate: toDateInput(experience.endDate),
    },
    ExperiencePropertiesSchema,
    async values => {
      await updateExperienceProperties(experience.id, values)
      router.refresh()
    },
  )
  const { values, set, commit, problems } = form
  const field = (name: 'company' | 'role' | 'location') => ({
    id: `role-${name}`,
    value: values[name] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(name, e.target.value),
    onBlur: commit,
    'aria-invalid': problems[name] ? true : undefined,
    'aria-describedby': problems[name] ? `role-${name}-problem` : undefined,
  })

  return (
    <>
      <div className="space-y-3">
        <PropertyRow id="role-role" label="Role" problem={problems.role}><Input className="max-md:h-11" {...field('role')} /></PropertyRow>
        <PropertyRow id="role-company" label="Company" problem={problems.company}><Input className="max-md:h-11" {...field('company')} /></PropertyRow>
        <PropertyRow id="role-location" label="Location"><Input className="max-md:h-11" {...field('location')} placeholder="Optional" /></PropertyRow>
        <label htmlFor="role-remote" className="flex min-h-9 items-center gap-2 text-sm max-md:min-h-11">
          <Checkbox
            id="role-remote"
            checked={values.remote}
            onCheckedChange={checked => { set('remote', checked === true); commit() }}
          />
          Remote
        </label>
        <div className="grid grid-cols-2 gap-3">
          <PropertyRow id="role-start" label="Start date" problem={problems.startDate}>
            <Input className="max-md:h-11" id="role-start" type="date" value={values.startDate} onChange={e => set('startDate', e.target.value)} onBlur={commit} aria-invalid={problems.startDate ? true : undefined} />
          </PropertyRow>
          <PropertyRow id="role-end" label="End date" problem={problems.endDate}>
            <Input className="max-md:h-11" id="role-end" type="date" value={values.endDate} onChange={e => set('endDate', e.target.value)} onBlur={commit} aria-invalid={problems.endDate ? true : undefined} />
          </PropertyRow>
        </div>
        <p className="text-xs text-muted-foreground">Leave the end date empty for a role you still hold.</p>
        <PropertiesStatus status={form.status} failure={form.failure} />
      </div>

      <div className="border-t pt-4">
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive max-md:h-11" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={13} aria-hidden="true" />
          Delete this experience…
        </Button>
      </div>

      {deleteOpen && (
        <DeleteExperienceDialog
          experience={experience}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={() => {
            setDeleteOpen(false)
            router.push(overviewHref())
            router.refresh()
          }}
        />
      )}
    </>
  )
}
