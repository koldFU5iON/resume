import Link from 'next/link'
import { requireProfile } from '@/lib/session'
import { listCoverLetters } from '@/modules/cover-letters/queries'
import { daysAgo, formatRelative, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LegacyEditorNotice } from '@/components/legacy-editors/deprecation'

export default async function CoverLettersPage() {
  const { profile } = await requireProfile()
  const letters = await listCoverLetters(profile.id)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6">
      <LegacyEditorNotice kind="cover-letter" className="mb-6 rounded-lg border" />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cover Letters</h1>
          {letters.length > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {letters.length} {letters.length === 1 ? 'draft' : 'drafts'}
            </p>
          )}
        </div>
        <Button size="sm" render={<Link href="/dashboard/cover-letters/new" />}>
          + New
        </Button>
      </div>

      {letters.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <p>No cover letters yet.</p>
          <p className="mt-1">
            <Link href="/dashboard/job-applications" className="underline">
              Start from a job application →
            </Link>{' '}
            or{' '}
            <Link href="/dashboard/cover-letters/new" className="underline">
              write a standalone letter
            </Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/50 rounded-md border">
            {letters.map(letter => {
              const snippet = (letter.content ?? '').split('\n').find(line => line.trim()) ?? ''
              const days = daysAgo(letter.updatedAt)
              return (
                <Link
                  key={letter.id}
                  href={`/dashboard/cover-letters/${letter.id}`}
                  className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {letter.jobTitle ?? 'Untitled'}
                      {letter.company ? ` · ${letter.company}` : ''}
                    </p>
                    {snippet && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{snippet}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn(
                      'text-xs',
                      letter.status === 'sent'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                    )}>
                      {letter.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {days !== null ? formatRelative(days) : ''}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            <Link href="/dashboard/job-applications" className="underline">
              Start a new letter from any job application in the jobs list →
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
