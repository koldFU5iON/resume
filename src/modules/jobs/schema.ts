import * as z from 'zod'
import { APPLICATION_SOURCES, APPLICATION_SOURCE_LABEL } from '@/app/types/job-application'

const jobSchemaBase = z.object({
  title: z.string().min(1, 'Job title is required'),
  company: z.string().optional(),
  url: z.string().optional().refine(
    val => !val || z.string().url().safeParse(val).success,
    { message: 'Must be a valid URL' },
  ),
  jobDescription: z.string().optional(),
  jobNumber: z.string().optional(),
  datePublished: z.date().optional(),
  location: z.string().optional(),
  applicationSource: z.enum(APPLICATION_SOURCES),
  salaryBand: z.string().optional(),
  isRecruitmentAgency: z.boolean().optional(),
  recruiterName: z.string().optional(),
})

export const createJobSchema = jobSchemaBase

// Same fields, all optional — for partial updates from the edit dialog.
export const updateJobSchema = jobSchemaBase.partial()

// Lives here (not next to assessJobFit) because action files use 'use server',
// which forbids non-async exports — schemas have to be reachable from a plain module.
// Constraints are intentionally loose: zod min/max bounds reject the whole
// response if the model trims or pads slightly, and the cost of a retry is
// real money. The prompt asks for 2–3 sentences; if the model returns 1 or 4
// it's still useful. Keep enum bounded — that one's load-bearing for the UI.
export const JobFitSchema = z.object({
  rating: z.number().min(0).max(10).describe('Overall fit score, 0 = no match, 10 = perfect match.'),
  label: z.enum(['reach', 'possible', 'stretch', 'solid', 'standout'])
    .describe('Bucketed verdict. "reach" = missing core requirements, rejected at first screen; "possible" = partial overlap, needs exceptional pitch; "stretch" = viable but has a meaningful gap; "solid" = strong baseline match, can compete in interviews; "standout" = unusually well-aligned.'),
  justification: z.string().min(1)
    .describe('Markdown with **Strengths:** and **Weaknesses:** sections (2 bullets each, one concise sentence per bullet), then one sentence overall summary. Concrete reasoning grounded in candidate and role specifics, no fluff.'),
  trajectoryNote: z.string().optional()
    .describe("One or two sentences on how this role relates to the candidate's stated career goals and target direction. Omit entirely when no career goals are provided."),
  notesUsed: z.boolean().optional()
    .describe('Set to true when personal notes were included in this assessment. Omit or set false otherwise.'),
})

export type JobFit = z.infer<typeof JobFitSchema>

export const JobAnalysisRiskSchema = z.object({
  risk: z.string().describe('A specific concern this role presents for the candidate.'),
  severity: z.enum(['high', 'medium', 'low']).describe('How likely this risk is to block the application. high = likely screened out; medium = needs addressing; low = minor.'),
  recommendation: z.string().describe('Concrete mitigation — what to emphasise or reframe in the CV.'),
})

export const JobAnalysisSchema = z.object({
  mustHave: z.array(z.string()).describe('Non-negotiable requirements per the job description.'),
  niceToHave: z.array(z.string()).describe('Preferred but not required skills or experience.'),
  risks: z.array(JobAnalysisRiskSchema),
  positioningStrategy: z.string().describe('1–2 sentences on how the candidate should frame their application — what to lead with, what to de-emphasise.'),
})

export type JobAnalysis = z.infer<typeof JobAnalysisSchema>
export type JobAnalysisRisk = z.infer<typeof JobAnalysisRiskSchema>

export const SalaryEstimateSchema = z.object({
  min:        z.number().nullable(),
  max:        z.number().nullable(),
  currency:   z.string(),
  source:     z.enum(['extracted', 'estimated']),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  reasoning:  z.string().optional(),
})

export type SalaryEstimate = z.infer<typeof SalaryEstimateSchema>

export const SOURCE_OPTIONS = APPLICATION_SOURCES.map(value => ({
  value,
  label: APPLICATION_SOURCE_LABEL[value],
}))
