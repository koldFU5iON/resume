import type { CVDocumentContent } from './schema'

/** An old CV Builder CV as its read-only view and PDF export take it. */
export type CVWithMeta = {
  id: string
  status: string
  jobTitle: string | null
  company: string | null
  jobApplicationId: string | null
  jobApplication?: {
    id: string
    title: string | null
    company: string | null
    jobDescription: string | null
  } | null
  profileName: string
  content: CVDocumentContent
}
