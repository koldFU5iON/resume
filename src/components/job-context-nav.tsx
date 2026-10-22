import Link from 'next/link'
import { cn } from '@/lib/utils'

export type JobContextNavProps = {
  jobId: string
  company: string | null
  title: string
  cvDocumentId: string | null
  coverLetterDocumentId: string | null
  interviewPrepSessionId: string | null
  current: 'cv' | 'cover-letter' | 'prep' | 'writing-desk'
}

export function JobContextNav({
  jobId,
  company,
  title,
  cvDocumentId,
  coverLetterDocumentId,
  interviewPrepSessionId,
  current,
}: JobContextNavProps) {
  const jobLabel = company ? `${company} — ${title}` : title
  const hubHref = `/dashboard/job-applications/view/${jobId}`

  return (
    <div className="flex items-center gap-3 border-b bg-background px-4 py-2 text-sm">
      <Link
        href={hubHref}
        className="min-w-0 truncate text-muted-foreground hover:text-foreground"
        title={jobLabel}
      >
        {jobLabel}
      </Link>
      <span className="shrink-0 text-border">|</span>
      <nav className="flex shrink-0 items-center gap-3">
        <Link
          href={hubHref}
          className="text-muted-foreground hover:text-foreground"
        >
          ← Hub
        </Link>
        <Link
          href={`/dashboard/job-applications/view/${jobId}/writing`}
          className={cn(
            'hover:text-foreground',
            current === 'writing-desk'
              ? 'font-medium text-foreground'
              : 'text-muted-foreground',
          )}
        >
          Writing Desk
        </Link>
        {cvDocumentId && (
          <Link
            href={`/dashboard/cv-builder/${cvDocumentId}`}
            className={cn(
              'hover:text-foreground',
              current === 'cv'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            CV
          </Link>
        )}
        {coverLetterDocumentId && (
          <Link
            href={`/dashboard/cover-letters/${coverLetterDocumentId}`}
            className={cn(
              'hover:text-foreground',
              current === 'cover-letter'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            Cover Letter
          </Link>
        )}
        {interviewPrepSessionId && (
          <Link
            href={`/dashboard/interview-prep/${interviewPrepSessionId}`}
            className={cn(
              'hover:text-foreground',
              current === 'prep'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            Prep
          </Link>
        )}
      </nav>
    </div>
  )
}
