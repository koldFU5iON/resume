import { ContentContainer } from "@/app/components/ContentContainer"
import { getFullProfile } from "@/modules/profile/queries"
import { ContactBlock } from "./_components/Contact"
import { ProfileHeader } from "./_components/ProfileHeader"
import { LeftRail } from "./_components/LeftRail"
import { ProjectBlock } from "./_components/ProjectBlock"
import { ProfileSummaryCard } from "./_components/ProfileSummaryCard"
import { ExperienceWorkspace } from "./_components/ExperienceWorkspace"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { requireProfile } from "@/lib/session"

export default async function Page() {
  const { profile: sessionProfile } = await requireProfile()
  const [profile, { configured: hasLLMKey }] = await Promise.all([
    getFullProfile(),
    getLLMConfigStatus(sessionProfile.id),
  ])

  const currentYear = new Date().getFullYear()
  const earliestYear =
    profile.experiences.length > 0
      ? Math.min(
          ...profile.experiences.map(e => new Date(e.startDate).getFullYear()),
        )
      : currentYear - 10
  const careerYears = Math.max(currentYear - earliestYear, 1)

  const contact = {
    phone: profile.phone ?? undefined,
    email: profile.email ?? undefined,
    site: profile.website ?? undefined,
    profile: profile.linkedIn ?? undefined,
    github: profile.github ?? undefined,
    location: profile.location ?? undefined,
  }

  // Profile-level projects (not linked to a specific experience)
  const profileLevelProjects = profile.projects.filter(p => !p.experienceId)

  return (
    <ContentContainer title="Professional Profile" fullWidth>
      <ProfileHeader name={profile.name} headline={profile.headline ?? undefined} />

      {/* 3-column workspace grid */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[256px_1fr_288px]">

        {/* Left column — identity */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <ContactBlock contact={contact} />
          <ProfileSummaryCard
            initialSummary={profile.summary}
            hasLLMKey={hasLLMKey}
          />
        </aside>

        {/* Centre column — experience workspace */}
        <div className="flex min-h-[600px] min-w-0 flex-col xl:sticky xl:top-6 xl:h-[calc(100vh-6rem)]">
          <ExperienceWorkspace profile={profile} />
        </div>

        {/* Right column — skills, education, credentials */}
        <aside className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <LeftRail
            skills={profile.skills}
            tools={profile.tools}
            languages={profile.languages}
            competencies={profile.competencies}
            educations={profile.educations}
            certifications={profile.certifications}
            careerYears={careerYears}
          />
        </aside>
      </div>

      {/* Profile-level projects (not linked to an experience) */}
      {profileLevelProjects.length > 0 && (
        <div className="mt-8">
          <ProjectBlock initial={profileLevelProjects} hasLLMKey={hasLLMKey} />
        </div>
      )}
    </ContentContainer>
  )
}
