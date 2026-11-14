import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireProfile } from '@/lib/session'
import { getExperienceWithSuggestionContext } from '@/modules/profile/queries'
import { ContentContainer } from '@/app/components/ContentContainer'
import { ChevronLeft } from 'lucide-react'
import { ExperienceDetailsForm } from './_components/ExperienceDetailsForm'
import { NotesEditor } from './_components/NotesEditor'

export default async function ExperienceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { profile } = await requireProfile()

  const ctx = await getExperienceWithSuggestionContext(id, profile.id)
  if (!ctx) notFound()

  const { experience, skills } = ctx

  return (
    <ContentContainer
      title={`${experience.role} · ${experience.company}`}
      fullWidth
    >
      <div className="mb-4">
        <Link
          href="/dashboard/profile"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Back to Profile
        </Link>
      </div>

      <ExperienceDetailsForm
        experienceId={experience.id}
        company={experience.company}
        role={experience.role}
        location={experience.location ?? null}
        remote={experience.remote}
        startDate={experience.startDate}
        endDate={experience.endDate ?? null}
      />

      <NotesEditor
        experienceId={experience.id}
        initialNotes={experience.summary ?? ''}
        initialRevision={experience.revision}
        name={`${experience.role} at ${experience.company}`}
        existingActivities={experience.activities}
        existingSkills={skills}
      />
    </ContentContainer>
  )
}
