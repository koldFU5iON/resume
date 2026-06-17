import { z } from 'zod'

export const ATSKeywordSchema = z.object({
  term: z.string(),
  category: z.enum(['tool', 'skill', 'methodology', 'certification', 'role-title']),
  profileEvidence: z.string().nullable(),
})

export const ATSContextSchema = z.object({
  supported: z.array(ATSKeywordSchema).describe(
    'Keywords the candidate has direct profile evidence for — use these exact terms',
  ),
  adjacent: z.array(ATSKeywordSchema).describe(
    'Keywords the candidate can credibly claim via transferable experience',
  ),
  absent: z.array(z.string()).describe(
    'Keywords with no profile basis — never suggest these',
  ),
})

export type ATSKeyword = z.infer<typeof ATSKeywordSchema>
export type ATSContextResult = z.infer<typeof ATSContextSchema>
