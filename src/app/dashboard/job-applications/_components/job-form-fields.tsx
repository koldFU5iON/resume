'use client'

import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { Loader2, RefreshCw, Sparkles, SquareArrowOutUpRight } from 'lucide-react'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FormField } from '../create/_components/form-field'
import { SalaryPopover } from './salary-popover'
import { SOURCE_OPTIONS } from '@/modules/jobs/schema'
import { isHttpUrl } from '@/modules/jobs/form-utils'
import { cn } from '@/lib/utils'
import type { SalaryEstimate } from '@/app/types/job-application'

type SalaryPopoverProps = {
  jobId: string
  initialEstimate: SalaryEstimate | null
  hasJD: boolean
  hasLLMKey: boolean
}

type JobFormFieldsProps = {
  isExtracting: boolean
  onExtract: () => void
  showReExtractLabel?: boolean
  showOpenLink?: boolean
  salaryPopoverProps?: SalaryPopoverProps
}

export function JobFormFields({
  isExtracting,
  onExtract,
  showReExtractLabel = false,
  showOpenLink = false,
  salaryPopoverProps,
}: JobFormFieldsProps) {
  const { control, watch, formState } = useFormContext()
  const isRecruitmentAgency = useWatch({ control, name: 'isRecruitmentAgency' })
  const urlValue = watch('url')
  // Legacy rows may hold another scheme: show it so it can be fixed, never link it.
  const linkUrl = typeof urlValue === 'string' && isHttpUrl(urlValue.trim()) ? urlValue.trim() : undefined

  return (
    <div className="space-y-4">
      <Controller
        name="url"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel>Job URL</FieldLabel>
            <InputGroup>
              <InputGroupInput
                {...field}
                type="url"
                placeholder="https://company.com/jobs/123"
                aria-invalid={fieldState.invalid}
              />
              <InputGroupAddon align="inline-end">
                {showOpenLink && (
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open job listing"
                    tabIndex={linkUrl ? 0 : -1}
                    aria-disabled={!linkUrl}
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-[calc(var(--radius)-3px)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      !linkUrl && 'pointer-events-none opacity-40',
                    )}
                  >
                    <SquareArrowOutUpRight size={13} />
                  </a>
                )}
                <InputGroupButton
                  type="button"
                  onClick={onExtract}
                  disabled={isExtracting || formState.isSubmitting || !urlValue}
                  className="gap-1"
                >
                  {isExtracting ? (
                    <><Loader2 size={12} className="animate-spin" /> Extracting…</>
                  ) : showReExtractLabel ? (
                    <><RefreshCw size={12} /> Re-extract</>
                  ) : (
                    <><Sparkles size={12} /> Extract</>
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField name="title" label="Job Title" placeholder="e.g. Senior Product Manager" required />
        <FormField
          name="company"
          label={isRecruitmentAgency ? 'Company (if known)' : 'Company'}
          placeholder={isRecruitmentAgency ? 'e.g. Google (optional)' : 'e.g. Google'}
          required={!isRecruitmentAgency}
        />
      </div>

      <Controller
        name="isRecruitmentAgency"
        control={control}
        render={({ field }) => (
          <div className="flex items-center gap-2">
            <Checkbox
              id="isRecruitmentAgency"
              checked={!!field.value}
              onCheckedChange={field.onChange}
            />
            <Label htmlFor="isRecruitmentAgency" className="text-sm font-normal cursor-pointer">
              Via recruitment agency
            </Label>
          </div>
        )}
      />

      {isRecruitmentAgency && (
        <FormField name="recruiterName" label="Recruiter / Agency Name" placeholder="e.g. Hays, Michael Page…" />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField name="location" label="Location" placeholder="e.g. London, UK or Remote" />
        <FormField name="jobNumber" label="Job Number" placeholder="e.g. JOB-123" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField name="datePublished" label="Date Published" type="date" />
        <Controller
          name="salaryBand"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <div className="flex items-center justify-between">
                <FieldLabel>Salary Band</FieldLabel>
                {salaryPopoverProps && <SalaryPopover {...salaryPopoverProps} />}
              </div>
              <Input {...field} placeholder="e.g. $120k–$160k" aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      <FormField
        name="applicationSource"
        label="Source"
        type="select"
        options={SOURCE_OPTIONS}
      />

      <FormField
        name="jobDescription"
        label="Job Description"
        type="textarea"
        placeholder="Paste or extract the full job description (markdown supported)"
        rows={8}
      />
    </div>
  )
}
