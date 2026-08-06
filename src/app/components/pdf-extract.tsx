import type { CVWithMeta } from '../dashboard/cv-builder/[id]/_components/cv-editor'
import type { CVSection, HeaderData, ExperienceData, EducationData, CertificationData, LanguagesData } from '@/modules/cv/schema'

type Props = { cv: CVWithMeta }

const SECTION_LABELS: Record<string, string> = {
  profile: 'Profile',
  competencies: 'Core Competencies',
  capabilities: 'Key Capabilities',
  experience: 'Professional Experience',
  education: 'Education',
  certification: 'Certifications',
  skills: 'Skills',
  tools: 'Tools & Technologies',
  languages: 'Languages',
}

export function PDFDocument({ cv }: Props) {
  const visibleSections = cv.content.sections.filter(s => s.visible)
  const header = visibleSections.find(s => s.type === 'header')
  const body = visibleSections.filter(s => s.type !== 'header')

  const seenTypes = new Set<string>()

  return (
    <main className="mx-auto w-[210mm] min-h-[297mm] bg-white text-black px-[14mm] py-[12mm] text-[10.5pt] leading-snug font-sans">
      {header && (() => {
        const d = header.data as HeaderData
        const contactItems = [d.contact.email, d.contact.phone, d.contact.linkedin, d.contact.website].filter(Boolean)
        return (
          <header className="border-b border-black pb-3 mb-4">
            <h1 className="text-[22pt] font-bold leading-none">{d.name}</h1>
            <p className="mt-0.5 text-[11pt]">{d.headline}</p>
            {d.subHeadline && <p className="text-[10pt] font-medium">{d.subHeadline}</p>}
            {d.location && <p className="text-[10pt]">{d.location}</p>}
            {contactItems.length > 0 && (
              <p className="mt-1 text-[9.5pt] text-gray-600">{contactItems.join(' · ')}</p>
            )}
          </header>
        )
      })()}

      {body.map((section, i) => {
        const isFirst = !seenTypes.has(section.type)
        seenTypes.add(section.type)
        return <PDFSection key={i} section={section} showHeading={isFirst} />
      })}
    </main>
  )
}

function PDFSection({ section, showHeading }: { section: CVSection; showHeading: boolean }) {
  const label = SECTION_LABELS[section.type]

  return (
    <section className="mb-4">
      {showHeading && label && (
        <div className="border-b border-black pb-0.5 mb-2">
          <h2 className="text-[9.5pt] font-bold uppercase tracking-wider">{label}</h2>
        </div>
      )}
      <PDFSectionBody section={section} />
    </section>
  )
}

function PDFSectionBody({ section }: { section: CVSection }) {
  switch (section.type) {
    case 'profile':
      return <p>{section.data.content}</p>

    case 'competencies':
    case 'capabilities':
      return (
        <ul className="list-disc pl-4 columns-2 gap-4">
          {section.data.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )

    case 'experience': {
      const d = section.data as ExperienceData
      return (
        <div className="mb-2">
          <div className="flex justify-between items-baseline gap-4">
            <p className="font-bold">{d.company}</p>
            <p className="text-[9.5pt] text-right whitespace-nowrap shrink-0">{d.duration} · {d.location}</p>
          </div>
          <p className="italic text-[10.5pt]">{d.titles.join(' → ')}</p>
          {d.subtitle && <p className="italic text-[9.5pt] text-gray-500">{d.subtitle}</p>}
          {d.description && <p className="mt-1 text-[10.5pt]">{d.description}</p>}
          {d.outcomes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {d.outcomes.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0">→</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    case 'education': {
      const d = section.data as EducationData
      return (
        <div className="flex justify-between items-baseline gap-4">
          <div>
            <p className="font-bold">{d.institution}</p>
            <p>{d.qualification}{d.field ? `, ${d.field}` : ''}{d.grade ? ` — ${d.grade}` : ''}</p>
          </div>
          <p className="text-[9.5pt] text-right whitespace-nowrap shrink-0">{d.duration}</p>
        </div>
      )
    }

    case 'certification': {
      const d = section.data as CertificationData
      return (
        <div className="flex justify-between items-baseline gap-4">
          <p>{d.name}{d.issuer ? ` · ${d.issuer}` : ''}</p>
          {d.date && <p className="text-[9.5pt] whitespace-nowrap shrink-0">{d.date}</p>}
        </div>
      )
    }

    case 'skills':
    case 'tools':
      return <p>{section.data.items.join(' · ')}</p>

    case 'languages': {
      const d = section.data as LanguagesData
      return (
        <p>{d.items.map(l => `${l.name} (${l.proficiency})`).join(' · ')}</p>
      )
    }

    default:
      return null
  }
}
