'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { extractJobFromUrl } from '@/modules/jobs/extract'
import { applyExtractedData } from '@/modules/jobs/form-utils'
import type { ExtractedJob } from '@/modules/jobs/extract-utils'
import { notifyUsageUpdated } from '@/lib/usage-events'

/**
 * One extraction flow for Add and Edit. A result is dropped when the run is
 * stale (cancelled, form closed or reopened, another run started) or the URL
 * field changed; fields typed during the wait are kept.
 */
export function useJobExtraction<T extends FieldValues>(form: UseFormReturn<T>) {
  const run = useRef(0)
  const [isExtracting, setIsExtracting] = useState(false)

  const cancel = useCallback(() => {
    run.current++
    setIsExtracting(false)
  }, [])

  // A late result must never reach an unmounted form.
  useEffect(() => () => { run.current++ }, [])

  async function extract(onApplied: (data: ExtractedJob, isCurrent: () => boolean) => void | Promise<void>) {
    const values = form.getValues() as Record<string, unknown>
    const url = typeof values.url === 'string' ? values.url.trim() : ''
    if (!url) { toast.error('Paste a job URL first'); return }

    const id = ++run.current
    const isCurrent = () => {
      const now = (form.getValues() as Record<string, unknown>).url
      return run.current === id && typeof now === 'string' && now.trim() === url
    }
    setIsExtracting(true)
    try {
      const result = await extractJobFromUrl(url)
      if (!isCurrent()) return
      if (!result.ok) { toast.error(result.error); return }
      applyExtractedData(form, result.data, values)
      await onApplied(result.data, isCurrent)
    } catch {
      if (isCurrent()) toast.error("Couldn't extract details. Check your connection and try again.")
    } finally {
      // The LLM tier may have run (and been billed) even when the call failed.
      notifyUsageUpdated()
      if (run.current === id) setIsExtracting(false)
    }
  }

  return { isExtracting, extract, cancel }
}
