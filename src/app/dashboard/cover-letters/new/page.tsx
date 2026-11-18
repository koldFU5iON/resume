import { redirect } from 'next/navigation'
import { createCoverLetter } from '@/modules/cover-letters/actions'
import { LegacyGenerationBanner } from '@/components/legacy-editors/legacy-generation-banner'

/** Retired entry: nothing links here any more. The banner points at the writing desk; the old flow still works on request (Phase 5 removes it). */
export default async function NewCoverLetterPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>
}) {
  const { jobId } = await searchParams

  async function createAnyway() {
    'use server'
    const { id } = await createCoverLetter(jobId)
    redirect(`/dashboard/cover-letters/${id}`)
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
      <LegacyGenerationBanner what="cover letter" jobId={jobId} />
      <form action={createAnyway}>
        <button type="submit" className="text-sm text-muted-foreground underline">
          Create with the old cover letter editor anyway
        </button>
      </form>
    </div>
  )
}
