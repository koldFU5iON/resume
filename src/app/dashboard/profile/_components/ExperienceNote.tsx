'use client'

import type { FullProfile } from '@/app/types/profile'
import type { PendingSuggestion } from '@/modules/profile-map/link-store'
import type { NoteCapabilityLink } from '@/modules/profile-map/note-links'
import { getNoteLiveState, updateExperienceNotes } from '@/modules/profile/actions'
import { NoteEditor } from './NoteEditor'
import { NoteFrame } from './NoteFrame'
import { DetailsTabs } from './DetailsTabs'
import { RoleProperties } from './RoleProperties'
import { experienceLabel, isEmployment } from '@/modules/profile/experience-type'
import { EvidencePanel, type EvidenceRole } from './EvidencePanel'
import { NoteLinksPanel } from './NoteLinksPanel'

const month = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

/**
 * A role as a note: its title and period above, its Markdown note as the
 * document, and Properties, Evidence and Links in the details region.
 */
export function ExperienceNote({ experience, skills, projects, roles, links, pending }: {
  experience: FullProfile['experiences'][number]
  skills: { id: string; name: string }[]
  /** The role's projects, whose evidence shows under the role's own. */
  projects: FullProfile['projects']
  roles: EvidenceRole[]
  links: NoteCapabilityLink[]
  /** Suggested links on this role's evidence and its projects'. */
  pending: PendingSuggestion[]
}) {
  const employment = isEmployment(experience)
  const name = experienceLabel(experience)
  const evidenceCount = experience.activities.length + projects.reduce((n, p) => n + (p.activities?.length ?? 0), 0)
  const facts = employment ? [
    `${month(experience.startDate)} – ${experience.endDate ? month(experience.endDate) : 'present'}`,
    experience.location ? `${experience.location}${experience.remote ? ' (remote)' : ''}` : experience.remote ? 'Remote' : null,
  ].filter(Boolean).join(' · ') : null

  return (
    <NoteFrame
      header={
        <div className="px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold leading-tight">
            {experience.role}{employment && <> <span className="font-normal text-muted-foreground">·</span> {experience.company}</>}
          </h1>
          {facts && <p className="mt-1 text-sm text-muted-foreground">{facts}</p>}
        </div>
      }
      details={
        <DetailsTabs
          label="Role details"
          tabs={[
            ...(employment ? [{ id: 'properties', label: 'Properties', panel: <RoleProperties key={experience.id} experience={experience} /> }] : []),
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
                  roles={roles}
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
        placeholder={employment ? "Write about this role: what it was, who you worked with, what you're proud of. Optional headings (## Overview, ## Responsibilities, ## Achievements, ## Skills) improve extraction." : "Write about your independent work."}
      />
    </NoteFrame>
  )
}
