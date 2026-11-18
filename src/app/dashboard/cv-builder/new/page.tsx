'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createAndGenerateCV } from '@/modules/cv/actions'
import { Loader2 } from 'lucide-react'
import { LegacyGenerationBanner } from '@/components/legacy-editors/legacy-generation-banner'

function GeneratingCV() {
  const router = useRouter()
  const params = useSearchParams()
  const jobId = params.get('jobId') ?? undefined
  const [error, setError] = useState<string | null>(null)
  // Generating costs LLM calls, so the retired generator waits for an explicit click.
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!started) return
    createAndGenerateCV({ jobApplicationId: jobId })
      .then(({ id }) => router.replace(`/dashboard/cv-builder/${id}`))
      .catch(err => setError(err instanceof Error ? err.message : 'Generation failed'))
  }, [started]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <LegacyGenerationBanner what="CV" jobId={jobId} />
        <button onClick={() => setStarted(true)} className="text-sm text-muted-foreground underline">
          Generate with the old CV builder anyway
        </button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={() => router.back()} className="text-sm text-muted-foreground underline">
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <p className="text-sm font-medium">
        {jobId ? 'Tailoring your CV to the job description…' : 'Building your master CV…'}
      </p>
      <p className="text-xs text-muted-foreground">This takes about 15–30 seconds</p>
    </div>
  )
}

export default function NewCVPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <GeneratingCV />
    </Suspense>
  )
}
