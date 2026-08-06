import * as z from 'zod'

// Structured output of the career vertical analysis pass (issue #308).
// Stored on the CareerVertical row as scalar array columns, not JSON — the
// strings are simple, bounded lists with no nested shape to preserve.
export const CareerVerticalAnalysisSchema = z.object({
  thesis: z.string().min(1)
    .describe('A concise 1–2 sentence statement of the business problems this candidate consistently solves. Framed around problems, not titles. Grounded in the candidate profile and the recurring threads.'),
  businessProblems: z.array(z.string())
    .describe('Recurring business problems the target roles exist to solve. 6–12 short noun phrases, each 3–10 words.'),
  responsibilities: z.array(z.string())
    .describe('Recurring day-to-day responsibilities the target roles demand. 6–12 short phrases, each 3–10 words.'),
  outcomes: z.array(z.string())
    .describe('Recurring results the target roles are expected to deliver. 6–12 short phrases, each 3–10 words.'),
  competencies: z.array(z.string())
    .describe('Recurring skills and competencies the target roles require. 6–12 short phrases, each 3–10 words.'),
})

export type CareerVerticalAnalysis = z.infer<typeof CareerVerticalAnalysisSchema>

// The slice of the CareerVertical row the analysis and master-CV passes read.
export type CareerVerticalThreads = {
  thesis: string | null
  businessProblems: string[]
  responsibilities: string[]
  outcomes: string[]
  competencies: string[]
}
