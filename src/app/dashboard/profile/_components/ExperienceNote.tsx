'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FullProfile } from '@/app/types/profile'
import { getNoteLiveState, updateExperienceNotes } from '@/modules/profile/actions'
import { overviewHref } from '@/modules/profile/note-index'
import { NoteEditor } from './NoteEditor'
import { NoteFrame } from './NoteFrame'
import { ExperienceFrontmatter } from './ExperienceFrontmatter'
import { ActivitiesTray } from './ActivitiesTray'
import { ExtractionPanel } from './ExtractionPanel'
import { EditExperienceDialog, DeleteExperienceDialog } from './ExperienceManageDialogs'

type ExperienceRow = FullProfile['experiences'][number]

/**
 * A role as a note: its title and key facts above, its Markdown note as the
 * document, and its evidence and extraction in the details region. The edit
 * and delete dialogs are the ones the profile page has always had.
 */
export function ExperienceNote({ experience, skills }: {
  experience: ExperienceRow
  skills: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const name = `${experience.role} at ${experience.company}`

  return (
    <>
      <NoteFrame
        header={
          <>
            <h1 className="px-4 pt-4 text-xl font-semibold leading-tight sm:px-6">
              {experience.role} <span className="font-normal text-muted-foreground">·</span> {experience.company}
            </h1>
            <ExperienceFrontmatter
              experience={experience}
              hideNameFields
              onEditClick={() => setEditOpen(true)}
              onDeleteClick={() => setDeleteOpen(true)}
            />
          </>
        }
        details={
          <>
            <ActivitiesTray experienceId={experience.id} initialActivities={experience.activities} />
            <ExtractionPanel
              experienceId={experience.id}
              existingActivities={experience.activities}
              existingSkills={skills}
            />
          </>
        }
        detailsLabel="Evidence and extraction"
      >
        <NoteEditor
          recoveryKey={`profile-note-recovery-experience-${experience.id}`}
          name={name}
          initialContent={experience.summary}
          initialRevision={experience.revision}
          onSave={(content, expectedRevision) => updateExperienceNotes(experience.id, content, expectedRevision)}
          loadLive={() => getNoteLiveState('experience', experience.id)}
          placeholder="Write about this role: what it was, who you worked with, what you're proud of. Optional headings (## Overview, ## Responsibilities, ## Achievements, ## Skills) improve extraction."
        />
      </NoteFrame>

      {editOpen && (
        <EditExperienceDialog
          experience={experience}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => router.refresh()}
        />
      )}
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
