import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getFullProfile } from '@/modules/profile/queries'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { requireProfile } from '@/lib/session'
import { buildProfileSummary } from '@/lib/profile-summary'
import { loadVault } from '@/modules/profile-map/load'
import { profileMap } from '@/modules/profile-map/map'
import { areaHref, findNote, vaultNoteHref } from '@/modules/profile/note-index'
import { ProfileCoachContext } from '../../_components/ProfileCoachContext'
import { ExperienceNote } from '../../_components/ExperienceNote'
import { ProjectNote } from '../../_components/ProjectNote'
import { NoteFrame } from '../../_components/NoteFrame'
import { ProfileHeader } from '../../_components/ProfileHeader'
import { ProfileSummaryCard } from '../../_components/ProfileSummaryCard'
import { ContactBlock } from '../../_components/Contact'

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { profile: session } = await requireProfile()
  const profile = await getFullProfile()
  const note = findNote(profile, id)
  if (!note) notFound()
  const profileSummary = buildProfileSummary(profile)

  if (note.kind === 'experience') {
    const experience = profile.experiences.find(e => e.id === note.id)!
    return (
      <>
        <ProfileCoachContext
          profileSummary={profileSummary}
          activeExperienceId={experience.id}
          activeExperienceName={`${experience.role} at ${experience.company}`}
        />
        <ExperienceNote experience={experience} skills={profile.skills.map(s => ({ id: s.id, name: s.name }))} />
      </>
    )
  }

  if (note.kind === 'project') {
    const project = profile.projects.find(p => p.id === note.id)!
    const role = note.experienceId ? profile.experiences.find(e => e.id === note.experienceId) : undefined
    const { configured: hasLLMKey } = await getLLMConfigStatus(session.id)
    return (
      <>
        <ProfileCoachContext
          profileSummary={profileSummary}
          activeExperienceId={role?.id}
          activeExperienceName={role ? `${role.role} at ${role.company}` : undefined}
        />
        <ProjectNote
          project={project}
          parent={role ? { id: role.id, title: `${role.role}, ${role.company}` } : null}
          hasLLMKey={hasLLMKey}
        />
      </>
    )
  }

  // Overview
  const vault = await loadVault(session.id)
  const gaps = profileMap(vault).gaps.map(gap => {
    const target = gap.noteId ? vault.notes.get(gap.noteId) : undefined
    return { message: gap.message, href: target ? vaultNoteHref(target) : areaHref(gap.area) }
  })
  const { configured: hasLLMKey } = await getLLMConfigStatus(session.id)

  return (
    <>
      <ProfileCoachContext profileSummary={profileSummary} />
      <NoteFrame
        header={<h1 className="px-4 py-4 text-xl font-semibold leading-tight sm:px-6">Overview</h1>}
        details={
          <>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Contact</h2>
            <ContactBlock
              contact={{
                phone: profile.phone ?? undefined,
                email: profile.email ?? undefined,
                site: profile.website ?? undefined,
                profile: profile.linkedIn ?? undefined,
                github: profile.github ?? undefined,
                location: profile.location ?? undefined,
              }}
            />
          </>
        }
        detailsLabel="Contact"
      >
        <div className="mx-auto w-full max-w-[calc(52ch+3rem)] space-y-8 px-4 py-6 sm:px-6">
          <ProfileHeader name={profile.name} headline={profile.headline ?? undefined} />
          <section aria-labelledby="overview-summary" className="space-y-2">
            <h2 id="overview-summary" className="text-sm font-semibold">Summary</h2>
            <ProfileSummaryCard initialSummary={profile.summary} hasLLMKey={hasLLMKey} />
          </section>
          {gaps.length > 0 && (
            <section aria-labelledby="overview-questions" className="space-y-2">
              <h2 id="overview-questions" className="text-sm font-semibold">Worth answering</h2>
              <ul className="space-y-1.5">
                {gaps.map((gap, i) => (
                  <li key={i} className="text-sm leading-6">
                    <Link href={gap.href} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                      {gap.message}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </NoteFrame>
    </>
  )
}
