import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireProfile } from '@/lib/session'
import { getCoverLetter } from '@/modules/cover-letters/queries'
import { listActiveJobsForPicker } from '@/modules/jobs/queries'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { JobWorkspace } from '@/components/job-workspace/job-workspace'
import { GuideClient } from './_components/guide-client'

type Props = { params: Promise<{ id: string }> }

export default async function GuidePage({ params }: Props) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const [letter, llmStatus, activeJobs] = await Promise.all([
    getCoverLetter(profile.id, id),
    getLLMConfigStatus(profile.id),
    listActiveJobsForPicker(profile.id),
  ])
  if (!letter) notFound()

  return (
    <JobWorkspace jobId={letter.jobApplicationId} current={{ kind: "cover-letter", id: letter.id }}>
      <div className="flex items-center gap-3 border-b px-4 py-2 text-sm">
        <Link
          href={`/dashboard/cover-letters/${id}`}
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to letter
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold">✦ Writing Guide</span>
        {(letter.jobTitle || letter.company) && (
          <span className="text-xs text-muted-foreground">
            {[letter.jobTitle, letter.company].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <GuideClient letter={letter} llmConfigured={llmStatus.configured} activeJobs={activeJobs} />
      </div>
    </JobWorkspace>
  )
}
