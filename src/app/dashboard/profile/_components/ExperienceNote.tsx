'use client'

import type { FullProfile } from '@/app/types/profile'
import type { PendingSuggestion } from '@/modules/profile-map/link-store'
import type { NoteCapabilityLink } from '@/modules/profile-map/note-links'
import { getNoteLiveState, updateExperienceNotes } from '@/modules/profile/actions'
import { NoteEditor } from './NoteEditor'
import { NoteFrame } from './NoteFrame'
import { DetailsTabs } from './DetailsTabs'
import { RoleProperties } from './RoleProperties'
import { EvidencePanel } from './EvidencePanel'
import { NoteLinksPanel } from './NoteLinksPanel'

const month = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

/**
 * A role as a note: its title and period above, its Markdown note as the
 * document, and Properties, Evidence and Links in the details region.
 */
export function ExperienceNote({ experience, skills, projects, links, pending }: {
  experience: FullProfile['experiences'][number]
  skills: { id: string; name: string }[]
  /** The role's projects, whose evidence shows under the role's own. */
  projects: FullProfile['projects']
  links: NoteCapabilityLink[]
  /** Suggested links on this role's evidence and its projects'. */
  pending: PendingSuggestion[]
}) {
  const name = `${experience.role} at ${experience.company}`
  const evidenceCount = experience.activities.length + projects.reduce((n, p) => n + (p.activities?.length ?? 0), 0)
  const facts = [
    `${month(experience.startDate)} – ${experience.endDate ? month(experience.endDate) : 'present'}`,
    experience.location ? `${experience.location}${experience.remote ? ' (remote)' : ''}` : experience.remote ? 'Remote' : null,
  ].filter(Boolean).join(' · ')

  return (
    <NoteFrame
      header={
        <div className="px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold leading-tight">
            {experience.role} <span className="font-normal text-muted-foreground">·</span> {experience.company}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{facts}</p>
        </div>
      }
      details={
        <DetailsTabs
          label="Role details"
          tabs={[
            { id: 'properties', label: 'Properties', panel: <RoleProperties key={experience.id} experience={experience} /> },
            {
              id: 'evidence',
              label: 'Evidence',
              count: String(evidenceCount),
              panel: (
                <EvidencePanel
                  key={experience.id}
                  owner={{ experienceId: experience.id }}
                  activities={experience.activities}
                  skills={skills}
                  fromProjects={projects.map(p => ({ id: p.id, name: p.name, activities: p.activities ?? [] }))}
                  moveTargets={projects.map(p => ({ owner: { projectId: p.id }, label: `Project: ${p.name}` }))}
                />
              ),
            },
            { id: 'links', label: 'Links', count: `${links.length} · ${pending.length}`, panel: <NoteLinksPanel capabilities={links} pending={pending} /> },
          ]}
        />
      }
      detailsLabel="Role details"
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
  )
}
