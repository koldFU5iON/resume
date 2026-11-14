'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FullProfile } from '@/app/types/profile'
import { getNoteLiveState, updateProjectNotes } from '@/modules/profile/actions'
import { noteHref, overviewHref } from '@/modules/profile/note-index'
import { NoteEditor } from './NoteEditor'
import { NoteFrame } from './NoteFrame'
import { ProjectDetails } from './ProjectBlock'

/**
 * A project as a note: its name as the title (with the role it belongs to,
 * if any), its Markdown note as the document, and its card, with the edit
 * dialog, in the details region.
 */
export function ProjectNote({ project, parent, hasLLMKey }: {
  project: FullProfile['projects'][number]
  /** The role this project belongs to. */
  parent: { id: string; title: string } | null
  hasLLMKey: boolean
}) {
  const router = useRouter()

  return (
    <NoteFrame
      header={
        <div className="px-4 py-4 sm:px-6">
          {parent && (
            <p className="mb-1 text-xs text-muted-foreground">
              Part of{' '}
              <Link href={noteHref(parent.id)} className="text-foreground underline underline-offset-2 hover:text-primary">{parent.title}</Link>
            </p>
          )}
          <h1 className="text-xl font-semibold leading-tight">{project.name}</h1>
        </div>
      }
      details={
        <ProjectDetails
          project={project}
          hasLLMKey={hasLLMKey}
          onDeleted={() => {
            router.push(parent ? noteHref(parent.id) : overviewHref())
            router.refresh()
          }}
        />
      }
      detailsLabel="Project details"
    >
      <NoteEditor
        recoveryKey={`profile-note-recovery-project-${project.id}`}
        name={project.name}
        initialContent={project.notes}
        initialRevision={project.revision}
        onSave={(content, expectedRevision) => updateProjectNotes(project.id, content, expectedRevision)}
        loadLive={() => getNoteLiveState('project', project.id)}
        placeholder="Write about this project: the problem, what you did, and how it turned out."
      />
    </NoteFrame>
  )
}
