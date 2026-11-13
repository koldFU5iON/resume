'use client'

import { useEffect, useState } from 'react'
import * as z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, FormProvider } from 'react-hook-form'
import { toast } from 'sonner'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { JobFormFields } from './job-form-fields'
import { DuplicateWarning } from './duplicate-warning'
import { useJobExtraction } from './use-job-extraction'
import { createJobSchema } from '@/modules/jobs/schema'
import { createJobApplication } from '@/modules/jobs/mutations'
import { getAtsHintFromUrl, addCompanyFromHint } from '@/modules/job-hunt/actions'
import { duplicateKey } from '@/modules/jobs/form-utils'
import { findPotentialDuplicates } from '@/modules/jobs/dedup'
import type { DuplicateMatch } from '@/modules/jobs/dedup-internal'

type AddJobDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialUrl?: string
}

type FormValues = z.infer<typeof createJobSchema>

const TITLE = 'Add Job'
const DESCRIPTION = 'Paste a URL and extract, or fill in the details manually.'

// A function, not a constant: no field (the publish date especially) gets a
// value the user didn't enter.
function emptyValues(url = ''): FormValues {
  return {
    title: '',
    company: '',
    url,
    location: '',
    jobNumber: '',
    salaryBand: '',
    jobDescription: '',
    datePublished: undefined,
    applicationSource: 'cold',
    isRecruitmentAgency: false,
    recruiterName: '',
  }
}

export function AddJobDialog({ open, onOpenChange, initialUrl }: AddJobDialogProps) {
  const isMobile = useIsMobile()
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  // The match set the user has been warned about; the same set again saves.
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(createJobSchema),
    defaultValues: emptyValues(),
  })
  const { isExtracting, extract, cancel } = useJobExtraction(form)
  const { isSubmitting, isDirty } = form.formState

  useEffect(() => {
    if (open) {
      form.reset(emptyValues(initialUrl ?? ''))
      setDuplicates([]) // eslint-disable-line react-hooks/set-state-in-effect
      setAcknowledgedKey(null)
    } else {
      cancel()
    }
    // Reset only when the form opens: a later prefill must not wipe a draft.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleOpenChange(next: boolean) {
    // Escape, backdrop, close button or drawer drag while saving: ignore.
    if (!next && form.formState.isSubmitting) return
    onOpenChange(next)
  }

  function handleExtract() {
    void extract(async (data, isCurrent) => {
      toast.success('Details extracted — review and submit')
      if (!data.title || !data.company) return
      try {
        const matches = await findPotentialDuplicates({
          jobNumber: data.jobNumber,
          title: data.title,
          company: data.company,
        })
        if (isCurrent()) setDuplicates(matches)
      } catch { /* the check runs again on submit */ }
    })
  }

  async function onSubmit(data: FormValues) {
    if (isExtracting) return

    let matches: DuplicateMatch[]
    try {
      matches = await findPotentialDuplicates({
        jobNumber: data.jobNumber,
        title: data.title,
        company: data.company,
      })
    } catch {
      toast.error("Couldn't check for duplicates. Nothing was added. Try again.")
      return
    }
    setDuplicates(matches)
    const key = duplicateKey(matches)
    if (matches.length > 0 && key !== acknowledgedKey) {
      setAcknowledgedKey(key)
      toast.warning('Possible duplicate. Submit again to add it anyway.')
      return
    }

    try {
      await createJobApplication(data)
    } catch {
      // A lost response can hide a create that succeeded; a retry re-runs the
      // duplicate check, which catches it when the job has a number or title + company.
      toast.error("Couldn't add the job. Your details are still here.")
      return
    }
    toast.success('Job added')
    onOpenChange(false)

    // Best effort, and never reported as a failed create.
    if (data.url && data.company) {
      try {
        const hint = await getAtsHintFromUrl(data.url, data.company)
        if (hint) {
          toast(`Watch ${data.company} for new roles?`, {
            description: `Detected ${hint.provider.charAt(0).toUpperCase() + hint.provider.slice(1)} ATS`,
            action: {
              label: 'Watch',
              onClick: () => { addCompanyFromHint(hint).catch(() => null) },
            },
          })
        }
      } catch { /* hint is optional */ }
    }
  }

  const submitLabel = isSubmitting
    ? 'Adding…'
    : duplicates.length > 0 && duplicateKey(duplicates) === acknowledgedKey
      ? 'Add anyway'
      : 'Add job'

  const formBody = (
    <FormProvider {...form}>
      <form
        id="create-job-form"
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
      >
        <JobFormFields isExtracting={isExtracting} onExtract={handleExtract} />
        <DuplicateWarning matches={duplicates} />
      </form>
    </FormProvider>
  )

  const cancelButton = (
    <Button
      type="button"
      variant="outline"
      className={isMobile ? 'flex-1' : undefined}
      onClick={() => handleOpenChange(false)}
      disabled={isSubmitting}
    >
      Cancel
    </Button>
  )

  const submitButton = (
    <Button
      type="submit"
      form="create-job-form"
      disabled={isSubmitting || isExtracting}
      className={isMobile ? 'flex-1' : undefined}
    >
      {submitLabel}
    </Button>
  )

  // One form state above both shells: crossing 768px while open keeps the values.
  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        dismissible={!isSubmitting}
        repositionInputs={false}
      >
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader>
            <DrawerTitle>{TITLE}</DrawerTitle>
            <DrawerDescription>{DESCRIPTION}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">{formBody}</div>
          <DrawerFooter className="flex-row justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {cancelButton}
            {submitButton}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      // Keep a half-filled form from vanishing on a stray click; Escape still closes.
      disablePointerDismissal={isDirty}
    >
      <DialogContent className="sm:max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">{formBody}</div>
        <DialogFooter className="shrink-0">
          {cancelButton}
          {submitButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
