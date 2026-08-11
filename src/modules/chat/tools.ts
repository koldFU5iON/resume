import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { parseJsonField } from '@/lib/utils'
import { normalizeSections } from '@/modules/interview-prep/schema'

type OwnershipTable =
  | 'cVDocument'
  | 'jobApplication'
  | 'interviewPrepSession'
  | 'coverLetterDocument'

// Security: every tool verifies the resource belongs to the session's profileId.
// profileId is always resolved server-side from the session cookie — never from
// LLM-generated tool arguments.
export async function assertOwnership(
  table: OwnershipTable,
  id: string,
  profileId: string,
): Promise<void> {
  const q = { where: { id }, select: { profileId: true } } as const
  let row: { profileId: string } | null = null
  switch (table) {
    case 'cVDocument':
      row = await prisma.cVDocument.findUnique(q)
      break
    case 'jobApplication':
      row = await prisma.jobApplication.findUnique(q)
      break
    case 'interviewPrepSession':
      row = await prisma.interviewPrepSession.findUnique(q)
      break
    case 'coverLetterDocument':
      row = await prisma.coverLetterDocument.findUnique(q)
      break
  }
  if (!row || row.profileId !== profileId) {
    throw new Error('Resource not found or access denied')
  }
}

export function createChatTools(profileId: string) {
  return {
    get_profile_section: tool({
      description:
        "Fetch detailed data for a section of the user's profile. Use when you need more depth than the profile overview provides.",
      inputSchema: zodSchema(
        z.object({
          section: z.enum(['skills', 'experience', 'projects', 'education', 'certifications', 'tools']),
        }),
      ),
      execute: async ({ section }) => {
        switch (section) {
          case 'skills':
            return prisma.skill
              .findMany({ where: { profileId }, orderBy: [{ level: 'asc' }, { name: 'asc' }] })
              .then(rows =>
                rows.map(s => ({
                  name: s.name,
                  category: s.category,
                  level: s.level,
                  yearsOfExperience: s.yearsOfExperience,
                  notes: s.notes,
                  tags: parseJsonField<string[]>(s.tags, []),
                })),
              )
          case 'experience':
            return prisma.experience
              .findMany({
                where: { profileId },
                include: { activities: true },
                orderBy: { startDate: 'desc' },
              })
              .then(rows =>
                rows.map(e => ({
                  company: e.company,
                  role: e.role,
                  startDate: e.startDate,
                  endDate: e.endDate,
                  summary: e.summary,
                  remote: e.remote,
                  achievements: e.activities
                    .filter(a => a.kind === 'achievement')
                    .sort((a, b) => a.order - b.order)
                    .map(a => a.description),
                  responsibilities: e.activities
                    .filter(a => a.kind === 'responsibility')
                    .sort((a, b) => a.order - b.order)
                    .map(a => a.description),
                  tags: parseJsonField<string[]>(e.tags, []),
                })),
              )
          case 'projects':
            return prisma.project
              .findMany({ where: { profileId }, orderBy: { startDate: 'desc' } })
              .then(rows =>
                rows.map(p => ({
                  name: p.name,
                  description: p.description,
                  status: p.status,
                  url: p.url,
                  highlights: parseJsonField<string[]>(p.highlights, []),
                  tags: parseJsonField<string[]>(p.tags, []),
                })),
              )
          case 'education':
            return prisma.education
              .findMany({ where: { profileId }, orderBy: { startDate: 'desc' } })
              .then(rows =>
                rows.map(e => ({
                  institution: e.institution,
                  qualification: e.qualification,
                  field: e.field,
                  startDate: e.startDate,
                  endDate: e.endDate,
                  grade: e.grade,
                  notes: e.notes,
                  tags: parseJsonField<string[]>(e.tags, []),
                })),
              )
          case 'certifications':
            return prisma.certification
              .findMany({ where: { profileId }, orderBy: { issueDate: 'desc' } })
              .then(rows =>
                rows.map(c => ({
                  name: c.name,
                  issuer: c.issuer,
                  issueDate: c.issueDate,
                  expiryDate: c.expiryDate,
                  credentialUrl: c.credentialUrl,
                  tags: parseJsonField<string[]>(c.tags, []),
                })),
              )
          case 'tools':
            return prisma.tool
              .findMany({ where: { profileId }, orderBy: [{ category: 'asc' }, { name: 'asc' }] })
              .then(rows => rows.map(t => ({ name: t.name, category: t.category })))
        }
      },
    }),

    get_job_application: tool({
      description: 'Fetch a job application including full job description, fit score, and notes.',
      inputSchema: zodSchema(z.object({ jobId: z.string() })),
      execute: async ({ jobId }) => {
        const job = await prisma.jobApplication.findUnique({ where: { id: jobId } })
        if (!job || job.profileId !== profileId) throw new Error('Resource not found or access denied')
        return {
          company: job.company,
          jobTitle: job.title,
          status: job.status,
          jobDescription: job.jobDescription,
          notes: job.notes,
          fitScore: (job.jobFit as { rating?: number } | null)?.rating ?? null,
          fitSummary: (job.jobFit as { summary?: string } | null)?.summary ?? null,
        }
      },
    }),

    get_cv_document: tool({
      description:
        "Fetch the full JSON content of a CV document. Use when the user wants to discuss or modify their CV.",
      inputSchema: zodSchema(z.object({ cvId: z.string() })),
      execute: async ({ cvId }) => {
        const cv = await prisma.cVDocument.findUnique({ where: { id: cvId } })
        if (!cv || cv.profileId !== profileId) throw new Error('Resource not found or access denied')
        return { id: cv.id, jobTitle: cv.jobTitle, company: cv.company, content: cv.generatedContent }
      },
    }),

    list_job_applications: tool({
      description:
        "List all of the user's job applications with their IDs, company, role, and status. Use when the user asks about a specific job but you don't have the job ID from page context, or to summarise their pipeline.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const jobs = await prisma.jobApplication.findMany({
          where: { profileId, archivedAt: null },
          select: { id: true, company: true, title: true, status: true, dateApplied: true },
          orderBy: { lastUpdated: 'desc' },
        })
        return jobs.map(j => ({
          jobId: j.id,
          company: j.company ?? null,
          role: j.title ?? null,
          status: j.status,
          dateApplied: j.dateApplied ?? null,
        }))
      },
    }),

    list_cv_documents: tool({
      description:
        "List all of the user's CV documents with their IDs, job titles, and companies. Use when the user references a CV by name but you don't have the cvId from page context.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const cvs = await prisma.cVDocument.findMany({
          where: { profileId },
          select: { id: true, jobTitle: true, company: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
        return cvs.map(c => ({
          cvId: c.id,
          jobTitle: c.jobTitle ?? null,
          company: c.company ?? null,
          createdAt: c.createdAt,
        }))
      },
    }),

    list_cover_letters: tool({
      description:
        "List all of the user's cover letter documents with their IDs, job titles, and companies. Use when the user references a cover letter but you don't have the letterId from page context.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const letters = await prisma.coverLetterDocument.findMany({
          where: { profileId },
          select: { id: true, jobTitle: true, company: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
        return letters.map(l => ({
          letterId: l.id,
          jobTitle: l.jobTitle ?? null,
          company: l.company ?? null,
          createdAt: l.createdAt,
        }))
      },
    }),

    list_interview_prep_sessions: tool({
      description:
        "List all of the user's interview prep sessions with their IDs, companies, and roles. Use this when the user mentions a prep session by name or company but you don't have the session ID from page context.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const sessions = await prisma.interviewPrepSession.findMany({
          where: { profileId },
          select: { id: true, company: true, jobTitle: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
        return sessions.map(s => ({
          sessionId: s.id,
          company: s.company ?? null,
          role: s.jobTitle ?? null,
          createdAt: s.createdAt,
        }))
      },
    }),

    get_interview_prep: tool({
      description:
        'Fetch an interview prep session including notes (with their blocks), documents, and interviewers. Each block in a note has a blockId — use it with propose_prep_note_update to suggest changes.',
      inputSchema: zodSchema(z.object({ sessionId: z.string() })),
      execute: async ({ sessionId }) => {
        await assertOwnership('interviewPrepSession', sessionId, profileId)
        const session = await prisma.interviewPrepSession.findUnique({
          where: { id: sessionId },
          include: {
            notes: { orderBy: { order: 'asc' } },
            documents: { orderBy: { createdAt: 'asc' } },
            interviewers: { orderBy: { createdAt: 'asc' } },
          },
        })
        if (!session) throw new Error('Interview prep session not found')
        return {
          sessionId: session.id,
          company: session.company,
          role: session.jobTitle,
          status: session.status,
          notes: session.notes.map(n => ({
            noteId: n.id,
            title: n.title,
            blocks: normalizeSections(n.sections).map(b => ({
              blockId: b.id,
              type: b.type,
              title: b.title,
              content: b.content,
            })),
          })),
          documents: session.documents.map(d => ({
            documentId: d.id,
            name: d.name,
            docType: d.docType,
            content: d.content,
          })),
          interviewers: session.interviewers.map(i => ({
            interviewerId: i.id,
            name: i.name,
            role: i.role,
            notes: i.notes,
            aiAnalysis: i.aiAnalysis,
          })),
        }
      },
    }),

    get_cover_letter: tool({
      description: 'Fetch the content of a cover letter document.',
      inputSchema: zodSchema(z.object({ letterId: z.string() })),
      execute: async ({ letterId }) => {
        await assertOwnership('coverLetterDocument', letterId, profileId)
        const letter = await prisma.coverLetterDocument.findUnique({ where: { id: letterId } })
        if (!letter) throw new Error('Cover letter not found')
        let sections: Array<{ id: string; content: string }> = []
        try { sections = JSON.parse(letter.sections) } catch { /* empty is fine */ }
        return {
          id: letter.id,
          company: letter.company,
          jobTitle: letter.jobTitle,
          content: letter.content,
          sections,
        }
      },
    }),

    // Write tools — no execute → client handles with confirmation card.
    // SECURITY: the PATCH route called on acceptance MUST independently verify
    // ownership (assertOwnership or equivalent). It cannot trust cvId/sessionId
    // values that originated from the LLM.
    propose_profile_update: tool({
      description:
        "Propose an update to a field on the user's profile. The user must confirm before it is applied.",
      inputSchema: zodSchema(
        z.object({
          field: z.string().describe('The profile field to update (e.g. "headline")'),
          currentValue: z.string().describe('The current value'),
          proposedValue: z.string().describe('The proposed new value'),
          rationale: z.string().describe('Why this change improves the profile'),
        }),
      ),
    }),

    propose_tool_create: tool({
      description:
        "Propose adding a new tool, platform, or software to the user's profile. Use when the user wants to add a tool that doesn't yet exist in their tools list. The user must confirm before it is applied.",
      inputSchema: zodSchema(
        z.object({
          name: z.string().describe('Tool or platform name (e.g. "Workato", "Figma", "dbt")'),
          category: z.string().optional().describe('Category label (e.g. "AI/Automation", "Design", "Data")'),
          rationale: z.string().describe('Why this tool should be added to the profile'),
        }),
      ),
    }),

    propose_cv_section_create: tool({
      description:
        "Propose adding a new custom section to a CV document. Use when the CV is " +
        "missing a section the user wants (e.g. a section that doesn't map to an " +
        "existing type). The user must confirm before it is applied.",
      inputSchema: zodSchema(
        z.object({
          cvId: z.string(),
          heading: z.string().describe('The heading for the new section'),
          subtype: z.enum(['text', 'list']),
          rationale: z.string().describe('Why this section should be added'),
        }),
      ),
    }),

    propose_cv_update: tool({
      description:
        'Propose an update to a section of a CV document. The user must confirm before it is applied. ' +
        'proposedData must contain the COMPLETE data object for the section (same shape as returned by get_cv_document), ' +
        'including all required fields (e.g. outcomes: string[] for experience). Omitted required fields cause the change to be rejected.',
      inputSchema: zodSchema(
        z.object({
          cvId: z.string(),
          sectionId: z.string().describe('The id of the CVSection to update'),
          sectionType: z.string().describe('The type of the section (e.g. "profile", "experience")'),
          proposedData: z.record(z.string(), z.unknown()).describe('Full proposed data object for the section — must include every required field'),
          rationale: z.string().describe('Why this change improves the CV'),
        }),
      ),
    }),

    propose_cover_letter_update: tool({
      description:
        'Propose a full replacement of a cover letter\'s content for the user to review and confirm. Call get_cover_letter first to read the current content.',
      inputSchema: zodSchema(
        z.object({
          letterId: z.string().describe('The ID of the cover letter to update'),
          proposedContent: z.string().describe('The full proposed markdown content for the cover letter'),
          rationale: z.string().describe('Brief explanation of what changed and why'),
        }),
      ),
    }),

    propose_cover_letter_section_update: tool({
      description:
        "Propose a replacement for a single paragraph in a cover letter. Use this instead of propose_cover_letter_update when the user wants to change one paragraph — it is cheaper and non-destructive. Call get_cover_letter first to get section IDs. The user must confirm before the change is applied.",
      inputSchema: zodSchema(
        z.object({
          letterId: z.string().describe('The ID of the cover letter'),
          sectionId: z.string().describe('The id field of the section to replace'),
          sectionIndex: z.number().int().describe('0-based index of the section, for display ("paragraph N of M")'),
          currentContent: z.string().describe('The current text of the section'),
          proposedContent: z.string().describe('The replacement paragraph text'),
          rationale: z.string().describe('What changed and why'),
        }),
      ),
    }),

    propose_prep_note_update: tool({
      description:
        'Propose an update to a block in an interview prep note. The user must confirm before it is applied. Call get_interview_prep first to get the noteId and blockId.',
      inputSchema: zodSchema(
        z.object({
          sessionId: z.string(),
          noteId: z.string(),
          blockId: z.string(),
          currentContent: z.string().describe('The current content of the block — shown to the user as the "before" state'),
          proposedContent: z.string().describe('The proposed new content for the block'),
          rationale: z.string().describe('Why this change improves the prep note'),
        }),
      ),
    }),

    submit_feedback: tool({
      description:
        "Submit a bug report or feature idea on behalf of the user. Use when the user describes a problem with the app or suggests a new feature or improvement. Gather a clear title and description from the conversation, then call this tool to present a confirmation before submitting.",
      inputSchema: zodSchema(
        z.object({
          type: z
            .enum(['bug', 'idea'])
            .describe("'bug' for problems, errors, or broken behaviour. 'idea' for feature requests or improvements."),
          title: z.string().max(200).describe('Short, clear title — one sentence.'),
          description: z
            .string()
            .max(2000)
            .describe(
              'Detailed description. For bugs: what happened and what was expected. For ideas: what it is and why it helps.',
            ),
        }),
      ),
      // No execute — confirmation card handles submission client-side
    }),
  }
}
