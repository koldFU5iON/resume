'use server'

// Server Action for the Deep dive button (spec §8): the same module function
// as POST /api/jobs/[id]/deep-dive. The calling page must export
// maxDuration = 300, since the run executes in after() (the job list, the job
// view page and its deep-dive report page do).

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/session'
import { startDeepDive as start } from './run'

export async function startDeepDiveAction(jobId: string) {
  const { profile } = await requireProfile()
  const result = await start(profile.id, jobId)
  if (result.kind === 'started') {
    revalidatePath('/dashboard/job-applications')
    revalidatePath(`/dashboard/job-applications/view/${jobId}`)
    revalidatePath(`/dashboard/job-applications/view/${jobId}/deep-dive`)
  }
  return result
}
