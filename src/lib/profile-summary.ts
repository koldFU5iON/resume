import type { FullProfile } from '@/app/types/profile'

export function buildProfileSummary(profile: FullProfile): string {
  const topSkills = [...profile.skills]
    .sort((a, b) => (b.yearsOfExperience ?? 0) - (a.yearsOfExperience ?? 0))
    .slice(0, 6)
    .map(s => s.name)
    .join(', ')

  // Jobs only: the independent experience ("Independent projects") has no dates or employer.
  const jobs = profile.experiences.filter(e => e.type !== 'independent')
  const experienceLines = jobs
    .map(e => {
      const start = new Date(e.startDate).getFullYear()
      const end = e.endDate ? new Date(e.endDate).getFullYear() : 'present'
      return `${e.role} @ ${e.company} (${start}–${end})`
    })
    .join(', ')

  const educationLine = profile.educations[0]
    ? `${profile.educations[0].qualification}, ${profile.educations[0].institution}`
    : ''

  const careerYears = jobs.length > 0
    ? new Date().getFullYear() - Math.min(...jobs.map(e => new Date(e.startDate).getFullYear()))
    : 0

  const lines = [
    `${profile.name ?? 'Unknown'} · ${profile.headline ?? ''} · ${careerYears} years experience`,
    topSkills ? `Skills: ${topSkills}` : '',
    experienceLines ? `Experience: ${experienceLines}` : '',
    educationLine ? `Education: ${educationLine}` : '',
  ]

  return lines.filter(Boolean).join('\n')
}
