import type { ProfileSnapshot } from '@/modules/profile/snapshot'
import type { CVDocumentContent, CVSection } from './schema'

type HeaderSource = Pick<ProfileSnapshot, 'name' | 'headline' | 'location' | 'email' | 'phone' | 'linkedin' | 'website'>

/**
 * Fills the CV header's identity and contact fields from the profile, in code.
 * The model never sees contact details (serializeProfileForLLM scrubs them),
 * so whatever it put there is replaced. The headline stays the model's: it is
 * tailored per job, and only falls back to the profile headline when empty.
 * A CV without a header section gets one at the top.
 */
export function fillCVHeader(content: CVDocumentContent, profile: HeaderSource): CVDocumentContent {
  const contact = {
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    linkedin: profile.linkedin ?? null,
    website: profile.website ?? null,
  }
  let found = false
  const sections = content.sections.map((section): CVSection => {
    if (section.type !== 'header') return section
    found = true
    return {
      ...section,
      data: {
        ...section.data,
        name: profile.name,
        headline: section.data.headline?.trim() || profile.headline || '',
        location: profile.location ?? section.data.location ?? null,
        contact,
      },
    }
  })
  if (found) return { ...content, sections }
  const header: CVSection = {
    id: 'header',
    type: 'header',
    visible: true,
    data: { name: profile.name, headline: profile.headline ?? '', location: profile.location ?? null, contact },
  }
  return { ...content, sections: [header, ...sections] }
}
