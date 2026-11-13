'use client'

import { useEffect } from 'react'
import * as z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, FormProvider } from 'react-hook-form'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { JobFormFields } from './job-form-fields'
import { updateJobSchema } from '@/modules/jobs/schema'
import { updateJobApplication } from '@/modules/jobs/mutations'
import { useJobExtraction } from './use-job-extraction'
import type { Job } from '@/app/types/job-application'

type EditJobDialogProps = {
  job: Job
  open: boolean
  onOpenChange: (open: boolean) => void
  hasLLMKey?: boolean
}

function valuesFromJob(job: Job): z.infer<typeof updateJobSchema> {
  return {
    title: job.title,
    company: job.company ?? '',
    url: job.url ?? '',
    location: job.countries.join(', '),
    jobNumber: job.jobNumber ?? '',
    jobDescription: job.jobDescription ?? '',
    datePublished: job.datePublished ?? undefined,
    applicationSource: job.applicationSource,
    salaryBand: job.salaryBand ?? '',
    isRecruitmentAgency: job.isRecruitmentAgency ?? false,
    recruiterName: job.recruiterName ?? '',
  }
}

export function EditJobDialog({ job, open, onOpenChange, hasLLMKey = false }: EditJobDialogProps) {
  const form = useForm<z.infer<typeof updateJobSchema>>({
    resolver: zodResolver(updateJobSchema),
    defaultValues: valuesFromJob(job),
  })

  const { isExtracting, extract } = useJobExtraction(form)

  useEffect(() => {
    if (open) form.reset(valuesFromJob(job))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job.id])

  async function onSubmit(data: z.infer<typeof updateJobSchema>) {
    try {
      const { staleFitData } = await updateJobApplication(job.id, data)
      if (staleFitData) {
        toast.warning('Job description changed. Your fit assessment may be outdated.', {
          action: {
            label: 'Reassess',
            onClick: () => { window.location.href = `/dashboard/job-applications/view/${job.id}` },
          },
          duration: 8000,
        })
      } else {
        toast.success('Job updated')
      }
      onOpenChange(false)
    } catch {
      toast.error('Failed to update job')
    }
  }

  function handleExtract() {
    void extract(() => { toast.success('Details refreshed — review and save') })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Job</DialogTitle>
          <DialogDescription>Update any field. Changes apply when you save.</DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form onSubmit={isExtracting ? (e) => e.preventDefault() : form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1">
              <JobFormFields
                isExtracting={isExtracting}
                onExtract={handleExtract}
                showReExtractLabel
                showOpenLink
                salaryPopoverProps={{
                  jobId: job.id,
                  initialEstimate: job.salaryEstimate ?? null,
                  hasJD: !!job.jobDescription?.trim(),
                  hasLLMKey,
                }}
              />
            </div>
            <DialogFooter className="shrink-0 pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting || isExtracting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  )
}
