import { Document, Page, View, Text, Link, StyleSheet } from '@react-pdf/renderer'
import type { CVWithMeta } from '../dashboard/cv-builder/[id]/_components/cv-editor'
import type { CVSection, HeaderData, ExperienceData, EducationData, CertificationData, LanguagesData, CustomData } from '@/modules/cv/schema'
import { parseInlineMarkdown } from '@/modules/cv/inline-markdown'

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

// Palette: charcoal text, amber accent on all structural lines + containers
const CHARCOAL = '#2D2D2D'
const AMBER = '#B8862E'

// Type scale: 10.5pt body, 10pt secondary (labels/dates/titles), 9.5pt micro (headings/contact)
const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    color: CHARCOAL,
    paddingTop: '14mm',
    paddingBottom: '14mm',
    paddingLeft: '14mm',
    paddingRight: '14mm',
    lineHeight: 1.4,
  },
  header: {
    borderBottomWidth: 1.5,
    borderBottomColor: AMBER,
    paddingBottom: 7,
    marginBottom: 12,
  },
  name: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: CHARCOAL,
    lineHeight: 1.1,
  },
  headline: {
    fontSize: 11.5,
    marginTop: 2,
  },
  subheadline: {
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    marginTop: 1,
  },
  contact: {
    fontSize: 9.5,
    color: '#444444',
    marginTop: 4,
  },
  section: {
    marginBottom: 11,
  },
  sectionCompact: {
    marginBottom: 6,
  },
  sectionHeadingWrap: {
    borderBottomWidth: 1,
    borderBottomColor: AMBER,
    paddingBottom: 2,
    marginBottom: 5,
  },
  sectionHeadingText: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: CHARCOAL,
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontFamily: 'Helvetica-Oblique' },
  link: { color: AMBER, textDecoration: 'none' },
  // Secondary: job titles, dates, locations — intentionally smaller than body
  meta: { fontSize: 10, color: '#111111' },
  metaRight: { fontSize: 10, color: '#111111', flexShrink: 0, textAlign: 'right' },
  // Annotation under the titles line — explains promotions/title changes
  subtitle: { fontSize: 10, fontStyle: 'italic', color: '#444444', marginTop: 1 },
  job: { marginBottom: 9 },
  jobDesc: { marginTop: 3 },
  bullet: { flexDirection: 'row', marginBottom: 2, marginTop: 1 },
  bulletDash: { width: 10, color: '#333333' },
  bulletText: { flex: 1 },
  // Two explicit columns side by side (flexWrap unreliable in react-pdf)
  twoColWrap: { flexDirection: 'row' },
  col: { flex: 1 },
  colItem: { marginBottom: 2.5 },
})

// Renders **bold**, *italic*, and bare emails/URLs as styled react-pdf runs
// inside a single <Text> block. Line breaks in the source string are
// preserved as-is by react-pdf's Text component.
function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((token, i) => {
        switch (token.type) {
          case 'bold':
            return <Text key={i} style={s.bold}>{token.value}</Text>
          case 'italic':
            return <Text key={i} style={s.italic}>{token.value}</Text>
          case 'link':
            return <Link key={i} src={token.href} style={s.link}>{token.value}</Link>
          default:
            return token.value
        }
      })}
    </>
  )
}

function SectionHeading({ label }: { label: string }) {
  return (
    // wrap={false} keeps the heading itself from splitting internally.
    // minPresenceAhead defers it to the next page unless some room remains
    // for content to follow — but that guard only takes effect when the
    // heading has already-placed siblings ahead of it in the same
    // pagination pass, which is why it must render as a sibling of
    // SectionBody rather than nested inside a shared wrapper (see below).
    <View style={s.sectionHeadingWrap} wrap={false} minPresenceAhead={40}>
      <Text style={s.sectionHeadingText}>{label.toUpperCase()}</Text>
    </View>
  )
}

function TwoColList({ items }: { items: string[] }) {
  const mid = Math.ceil(items.length / 2)
  const left = items.slice(0, mid)
  const right = items.slice(mid)
  return (
    <View style={s.twoColWrap}>
      <View style={s.col}>
        {left.map((item, i) => <Text key={i} style={s.colItem}>- {item}</Text>)}
      </View>
      <View style={s.col}>
        {right.map((item, i) => <Text key={i} style={s.colItem}>- {item}</Text>)}
      </View>
    </View>
  )
}

function getSectionLabel(section: CVSection): string | undefined {
  if (section.type === 'custom') return (section.data as CustomData).heading || 'Custom'
  return SECTION_LABELS[section.type]
}

function SectionBody({ section }: { section: CVSection }) {
  switch (section.type) {
    case 'profile':
      return <Text><InlineMarkdown text={section.data.content} /></Text>

    case 'competencies':
    case 'capabilities':
      return <TwoColList items={section.data.items} />

    case 'experience': {
      const d = section.data as ExperienceData
      return (
        <View style={s.job}>
          <View style={s.row}>
            <Text style={s.bold}>{d.company}</Text>
            <Text style={s.metaRight}>{d.duration} · {d.location}</Text>
          </View>
          <Text style={[s.meta, s.italic]}>{d.titles.join(' / ')}</Text>
          {d.subtitle ? <Text style={s.subtitle}>{d.subtitle}</Text> : null}
          {d.description ? <Text style={s.jobDesc}>{d.description}</Text> : null}
          {d.outcomes.map((o, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.bulletDash}>-</Text>
              <Text style={s.bulletText}>{o}</Text>
            </View>
          ))}
        </View>
      )
    }

    case 'education': {
      const d = section.data as EducationData
      return (
        <View style={s.row}>
          <View>
            <Text style={s.bold}>{d.institution}</Text>
            <Text style={s.meta}>{d.qualification}{d.field ? `, ${d.field}` : ''}{d.grade ? ` - ${d.grade}` : ''}</Text>
          </View>
          <Text style={s.metaRight}>{d.duration}</Text>
        </View>
      )
    }

    case 'certification': {
      const d = section.data as CertificationData
      return (
        <View style={s.row}>
          <Text>{d.name}{d.issuer ? ` - ${d.issuer}` : ''}</Text>
          {d.date ? <Text style={s.metaRight}>{d.date}</Text> : null}
        </View>
      )
    }

    case 'skills':
      return <Text>{section.data.items.join(' · ')}</Text>

    case 'tools':
      return <Text>{section.data.items.join(' · ')}</Text>

    case 'languages': {
      const d = section.data as LanguagesData
      return <Text>{d.items.map(l => `${l.name} (${l.proficiency})`).join(' / ')}</Text>
    }

    case 'custom': {
      const d = section.data as CustomData
      return d.subtype === 'text'
        ? <Text><InlineMarkdown text={d.content ?? ''} /></Text>
        : (
          <View>
            {(d.items ?? []).map((item, i) => (
              <View key={i} style={s.bullet}>
                <Text style={s.bulletDash}>-</Text>
                <Text style={s.bulletText}><InlineMarkdown text={item} /></Text>
              </View>
            ))}
          </View>
        )
    }

    default:
      return null
  }
}

export function CVPDFDocument({ cv }: { cv: CVWithMeta }) {
  const visibleSections = cv.content.sections.filter(sec => sec.visible)
  const header = visibleSections.find(sec => sec.type === 'header')
  const body = visibleSections.filter(sec => sec.type !== 'header')
  const seenTypes = new Set<string>()

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {header && (() => {
          const d = header.data as HeaderData
          const contactItems = [d.contact.email, d.contact.phone, d.contact.linkedin, d.contact.website]
            .filter((v): v is string => !!v)
          return (
            <View style={s.header}>
              <Text style={s.name}>{d.name}</Text>
              <Text style={s.headline}>{d.headline}</Text>
              {d.subHeadline ? <Text style={s.subheadline}>{d.subHeadline}</Text> : null}
              {d.location ? <Text style={s.contact}>{d.location}</Text> : null}
              {contactItems.length > 0 ? <Text style={s.contact}>{contactItems.join(' · ')}</Text> : null}
            </View>
          )
        })()}

        {body.map((section, i) => {
          const label = getSectionLabel(section)
          const isFirst = section.type === 'custom' ? true : !seenTypes.has(section.type)
          seenTypes.add(section.type)
          // Compact sections (certs, skills rows, languages) that stack without a
          // sub-heading get much tighter spacing than full sections like experience.
          const COMPACT_TYPES = new Set(['certification', 'skills', 'tools', 'languages'])
          const compact = !isFirst && COMPACT_TYPES.has(section.type)
          // The heading renders as a page-level sibling of the body View,
          // not nested inside a shared wrapper — react-pdf's pagination
          // only lets minPresenceAhead defer an orphaned heading to the
          // next page when it has already-placed siblings ahead of it in
          // the same pass, which a nested wrapper (where the heading is
          // always the first child) would prevent.
          return [
            isFirst && label ? <SectionHeading key={`${i}-heading`} label={label} /> : null,
            <View key={`${i}-body`} style={compact ? s.sectionCompact : s.section}>
              <SectionBody section={section} />
            </View>,
          ]
        })}
      </Page>
    </Document>
  )
}
