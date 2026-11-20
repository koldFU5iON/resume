'use client'

import Link from 'next/link'
import type { FullProfile } from '@/app/types/profile'
import type { PendingSuggestion } from '@/modules/profile-map/link-store'
import type { NoteCapabilityLink } from '@/modules/profile-map/note-links'
import { getNoteLiveState, updateProjectNotes } from '@/modules/profile/actions'
import { noteHref, overviewHref } from '@/modules/profile/note-index'
import { NoteEditor } from './NoteEditor'
import { NoteFrame } from './NoteFrame'
import { DetailsTabs } from './DetailsTabs'
import { ProjectProperties } from './ProjectProperties'
import { EvidencePanel } from './EvidencePanel'
import { NoteLinksPanel } from './NoteLinksPanel'

/**
 * A project as a note: its name as the title (with the role it belongs to,
 * if any), its Markdown note as the document, and Properties, Evidence and
 * Links in the details region.
 */
export function ProjectNote({ project, parent, siblings = [], roles, skills, links, pending }: {
  project: FullProfile['projects'][number]
  /** The role this project belongs to. */
  parent: { id: string; title: string } | null
  /** The other projects of the same role: places this project's evidence can move to. */
  siblings?: { id: string; name: string }[]
  /** Every role the project could be moved to. */
  roles: { id: string; label: string }[]
  skills: { id: string; name: string }[]
  links: NoteCapabilityLink[]
  pending: PendingSuggestion[]
}) {
  const activities = project.activities ?? []

  return (
    <NoteFrame
      header={
        <div className="px-4 py-4 sm:px-6">
          {parent && (
            <p className="mb-1 text-xs text-muted-foreground">
              Part of{' '}
              <Link href={noteHref(parent.id)} className="inline-flex min-h-8 items-center text-foreground underline underline-offset-2 hover:text-primary max-md:min-h-11">{parent.title}</Link>
            </p>
          )}
          <h1 className="text-xl font-semibold leading-tight">{project.name}</h1>
        </div>
      }
      details={
        <DetailsTabs
          label="Project details"
          tabs={[
            { id: 'properties', label: 'Properties', panel: <ProjectProperties key={project.id} project={project} roles={roles} afterDeleteHref={parent ? noteHref(parent.id) : overviewHref()} /> },
            {
              id: 'evidence',
              label: 'Evidence',
              count: String(activities.length),
              panel: <EvidencePanel key={project.id} owner={{ projectId: project.id }} activities={activities} skills={skills} moveTargets={[...(parent ? [{ owner: { experienceId: parent.id }, label: `Role: ${parent.title}` }] : []), ...siblings.map(s => ({ owner: { projectId: s.id }, label: `Project: ${s.name}` }))]} />,
            },
            { id: 'links', label: 'Links', count: `${links.length} · ${pending.length}`, panel: <NoteLinksPanel capabilities={links} pending={pending} /> },
          ]}
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
