'use client'

import { useTransition } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AssessmentPoller, notifyAssessmentStarted } from '@/app/dashboard/job-applications/_components/assessment-poller'
import { startAssessmentBackfill } from '@/modules/job-assessment/actions'
import type { BackfillStatus } from '@/modules/job-assessment/backfill'

function jobs(n: number): string {
  return n === 1 ? '1 not-started job has' : `${n} not-started jobs have`
}

/** Settings card: assess "not started" jobs that have no early assessment, one batch at a time. */
export function EarlyAssessmentBackfill({ status }: { status: BackfillStatus }) {
  const [starting, startTransition] = useTransition()
  const { eligible, pending, remainingCalls, nextBatch, limitedBy, callsPerJob } = status
  const running = pending > 0

  function handleStart() {
    startTransition(async () => {
      const res = await startAssessmentBackfill()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (res.queued === 0) {
        toast.message(res.limitedBy === 'daily_cap' ? 'Daily limit reached; the rest can run tomorrow.' : 'Nothing to assess.')
        return
      }
      notifyAssessmentStarted()
      toast.success(`Assessing ${res.queued} ${res.queued === 1 ? 'job' : 'jobs'}`)
    })
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <Gauge size={18} className="mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-medium text-sm">Early assessment</p>
          <div className="text-xs text-muted-foreground mt-0.5" aria-live="polite">
            {running ? (
              <p className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                Assessing… {pending} left in this batch.
              </p>
            ) : eligible === 0 ? (
              <p>Every not-started job has an early assessment.</p>
            ) : (
              <>
                <p>{jobs(eligible)} no early assessment.</p>
                <p className="mt-0.5">
                  Uses about {callsPerJob} assessment calls per job; {remainingCalls} left today.
                </p>
                {limitedBy === 'daily_cap' && (
                  <p className="mt-0.5">
                    {nextBatch === 0
                      ? 'Daily limit reached; the rest can run tomorrow.'
                      : `Today's limit covers ${nextBatch} more; the rest can run tomorrow.`}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {!running && nextBatch > 0 && (
          <Button size="sm" onClick={handleStart} disabled={starting}>
            {starting && <Loader2 className="animate-spin" aria-hidden="true" />}
            Assess next {nextBatch}
          </Button>
        )}
      </div>
      <AssessmentPoller signature={running ? `${pending}:${eligible}` : ''} />
    </Card>
  )
}
