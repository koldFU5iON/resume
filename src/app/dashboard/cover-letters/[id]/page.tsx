import { notFound } from 'next/navigation'
import { requireProfile } from '@/lib/session'
import { getCoverLetter } from '@/modules/cover-letters/queries'
import { JobWorkspace } from '@/components/job-workspace/job-workspace'
import { CoverLetterWorkspace } from './_components/cover-letter-workspace'

type Props = { params: Promise<{ id: string }> }

export default async function CoverLetterPage({ params }: Props) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const letter = await getCoverLetter(profile.id, id)
  if (!letter) notFound()

  return (
    <JobWorkspace jobId={letter.jobApplicationId} current={{ kind: "cover-letter", id: letter.id }}>
      <CoverLetterWorkspace letter={letter} />
    </JobWorkspace>
  )
}
