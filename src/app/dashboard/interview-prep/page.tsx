import Link from 'next/link'
import { requireProfile } from '@/lib/session'
import { listSessions } from '@/modules/interview-prep/queries'
import { Button } from '@/components/ui/button'
import { daysAgo, formatRelative } from '@/lib/utils'
import { LegacyEditorNotice } from '@/components/legacy-editors/deprecation'

export default async function InterviewPrepPage() {
  const { profile } = await requireProfile()
  const sessions = await listSessions(profile.id)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6">
      <LegacyEditorNotice kind="interview-prep" className="mb-6 rounded-lg border" />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview Prep</h1>
          {sessions.length > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
            </p>
          )}
        </div>
        <Button size="sm" render={<Link href="/dashboard/interview-prep/new" />}>
          + New
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <p>No prep sessions yet.</p>
          <p className="mt-1">
            <Link href="/dashboard/interview-prep/new" className="underline">
              Start your first session →
            </Link>
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50 rounded-md border">
          {sessions.map(session => {
            const days = daysAgo(session.updatedAt)
            return (
              <Link
                key={session.id}
                href={`/dashboard/interview-prep/${session.id}`}
                className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{session.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {session._count.notes} {session._count.notes === 1 ? 'note' : 'notes'}
                    {session._count.documents > 0 && ` · ${session._count.documents} docs`}
                    {session._count.interviewers > 0 && ` · ${session._count.interviewers} interviewers`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">
                    {days !== null ? formatRelative(days) : ''}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
