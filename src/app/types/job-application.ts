import type { JobApplication } from "@prisma/client"

export const ApplicationStatus = {
  NotStarted: "not started",
  InProgress: "in-progress",
  Applied: "applied",
  Interviewing: "interviewing",
  Accepted: "accepted",
  Rejected: "rejected",
} as const

export type ApplicationStatusType = typeof ApplicationStatus[keyof typeof ApplicationStatus]

// The job is still live and being worked.
// in-progress sits between not-started and applied — the user is preparing
// CV/cover letter but hasn't submitted yet.
export const OpenStatuses = [
  ApplicationStatus.NotStarted,
  ApplicationStatus.InProgress,
  ApplicationStatus.Applied,
  ApplicationStatus.Interviewing,
] as const

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatusType, string> = {
  [ApplicationStatus.NotStarted]: "Not started",
  [ApplicationStatus.InProgress]: "In progress",
  [ApplicationStatus.Applied]: "Applied",
  [ApplicationStatus.Interviewing]: "Interviewing",
  [ApplicationStatus.Accepted]: "Accepted",
  [ApplicationStatus.Rejected]: "Rejected",
}

// The job is closed — a final outcome was reached.
export const ClosedStatuses = [
  ApplicationStatus.Accepted,
  ApplicationStatus.Rejected,
] as const

// Funnel order: each stage represents progressively further along.
// Status auto-advances progress to the matching floor in mutations.ts.
export const ApplicationProgress = {
  NotStarted: "not started",
  Preparing: "preparing",
  Pending: "awaiting response",
  Recruiter: "recruiter screening",
  Interview: "interview",
  Project: "take-home project",
  Offer: "offer",
} as const

export type ApplicationProgressType = typeof ApplicationProgress[keyof typeof ApplicationProgress]

// How the opportunity entered the pipeline — distinct from status (where the
// application is in the funnel) and progress (which interview stage).
export const ApplicationSource = {
  Cold: "cold",
  Referral: "referral",
  RecruiterOutreach: "recruiter_outreach",
} as const

export type ApplicationSourceType = typeof ApplicationSource[keyof typeof ApplicationSource]

export const APPLICATION_SOURCES = [
  ApplicationSource.Cold,
  ApplicationSource.Referral,
  ApplicationSource.RecruiterOutreach,
] as const

export const APPLICATION_SOURCE_LABEL: Record<ApplicationSourceType, string> = {
  [ApplicationSource.Cold]: "Cold",
  [ApplicationSource.Referral]: "Referral",
  [ApplicationSource.RecruiterOutreach]: "Recruiter outreach",
}

export type JobFit = {
  rating: number
  label: "reach" | "possible" | "stretch" | "solid" | "standout"
  justification: string
  trajectoryNote?: string
  notesUsed?: boolean
}

export type SalaryEstimate = {
  min:         number | null
  max:         number | null
  currency:    string
  source:      'extracted' | 'estimated'
  confidence?: 'low' | 'medium' | 'high'
  reasoning?:  string
}

export type Job = Omit<JobApplication, "status" | "progress" | "jobFit" | "applicationSource"> & {
  status: ApplicationStatusType
  progress: ApplicationProgressType
  jobFit?: JobFit | null
  applicationSource: ApplicationSourceType
  cvDocumentId?: string | null
  coverLetterDocumentId?: string | null
  interviewPrepSessionId?: string | null
  salaryEstimate?: SalaryEstimate | null
}

export type ProfileType = {
  name: string,
  headline: string[],
  subHeadline: string[],
  links: ProfileLink[],
  contact: ProfileContact[],
  about: string,
  competency: string[],
}

type ProfileContact = {
  type: string
  value: string
}

type ProfileLink = {
  name: string
  url: string
}
