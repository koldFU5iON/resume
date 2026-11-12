import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { getJobApplicationById, getJobContactsAndEvents } from "@/modules/jobs/queries"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { toDeepDiveAccess } from "@/modules/deep-dive/access"
import { isEarlyAssessmentEnabled } from "@/modules/job-assessment/queries"
import { getJobSponsorStatus } from "@/modules/companies/queries"
import { getJobSpend } from "@/modules/llm/job-cost"
import { MarkdownProse } from "@/components/ui/markdown-prose"
import { formatDate } from "@/lib/utils"
import { APPLICATION_SOURCE_LABEL, type Job } from "@/app/types/job-application"
import { JobFit } from "@/app/dashboard/job-applications/_components/job-fit"
import { EarlyAssessment } from "@/app/dashboard/job-applications/_components/early-assessment"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { pendingSignature } from "@/app/dashboard/job-applications/_components/early-assessment-view"
import { deepDiveSignature } from "@/app/dashboard/job-applications/_components/deep-dive-view"
import { SalaryPopover } from "@/app/dashboard/job-applications/_components/salary-popover"
import { JobNotesPane } from "./_components/job-notes-pane"
import { JobPageContext } from "./_components/job-page-context"
import { JobDescriptionActions } from "./_components/job-description-actions"
import { DeepDiveEntry } from "./_components/deep-dive-entry"
import { JobSpendCard } from "./_components/job-spend"
import { SponsorChip } from "./_components/sponsor-chip"

// Server Actions on this page queue the early job assessment and start deep
// dives, which run in after() within this limit; keep in sync with
// ROUTE_MAX_DURATION_S (src/modules/job-assessment/queue.ts) and
// DEEP_DIVE_ROUTE_MAX_DURATION_S (src/modules/deep-dive/schema.ts).
export const maxDuration = 300

/**
 * Job Description: the workspace's first document (#369). The description and
 * its factual metadata lead; notes, fit, history and spend stay one click away.
 * The job header and document navigation come from the layout.
 */
export default async function ViewJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [job, { profile }] = await Promise.all([
    getJobApplicationById(id),
    requireProfile(),
  ])

  if (!job) {
    notFound()
  }

  const [llmConfig, earlyEnabled, sponsor, spend, history] = await Promise.all([
    getLLMConfigStatus(profile.id),
    isEarlyAssessmentEnabled(profile.id),
    // Nice-to-haves: a failed lookup must not break the page.
    getJobSponsorStatus(profile.id, job.id).catch(() => null),
    getJobSpend(profile.id, job.id).catch(() => null),
    getJobContactsAndEvents(profile.id, job.id),
  ])
  const hasLLMKey = llmConfig.configured
  const deepDiveAccess = toDeepDiveAccess(llmConfig)
  const early = job.earlyAssessment ?? null
  // One poller for the page: the early assessment and the deep dive, while either runs.
  const pending = [pendingSignature([early]), deepDiveSignature(job.deepDive)].filter(Boolean).join(',')
  const location = job.countries.join(' · ')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <JobPageContext jobId={job.id} title={job.title} company={job.company} status={job.status} />
      <AssessmentPoller signature={pending} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">Job Description</h2>
        <JobDescriptionActions job={job} hasLLMKey={hasLLMKey} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-b pb-6 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label="Company">
          <span className="flex flex-wrap items-center gap-1.5">
            {job.company || 'Not set'}
            <SponsorChip sponsor={sponsor} />
          </span>
        </Fact>
        <Fact label="Location">{location || 'Not set'}</Fact>
        <Fact
          label="Salary"
          action={
            <SalaryPopover
              jobId={job.id}
              initialEstimate={job.salaryEstimate ?? null}
              hasJD={!!job.jobDescription?.trim()}
              hasLLMKey={hasLLMKey}
            />
          }
        >
          {job.salaryBand || 'Not set'}
        </Fact>
        <Fact label="Source">
          {APPLICATION_SOURCE_LABEL[job.applicationSource] ?? job.applicationSource}
          {job.isRecruitmentAgency && (
            <span className="block text-xs text-muted-foreground">
              Agency{job.recruiterName ? ` · ${job.recruiterName}` : ''}
            </span>
          )}
        </Fact>
        <Fact label="Posted">{formatDate(job.datePublished, 'Unknown')}</Fact>
      </dl>

      <div className="mt-6 max-w-[72ch]">
        {job.jobDescription?.trim() ? (
          <MarkdownProse content={job.jobDescription} />
        ) : (
          <p className="text-sm text-muted-foreground">No job description added yet. Use Edit details to add one.</p>
        )}
      </div>

      <div className="mt-10 divide-y border-y">
        <Section title="Job notes" summary={job.notes?.trim() ? undefined : 'Empty'} defaultOpen={!!job.notes?.trim()}>
          <JobNotesPane jobId={job.id} notes={job.notes} notesIncludeInFit={job.notesIncludeInFit} />
        </Section>

        <Section title="Fit assessment and Deep Dive">
          <FitDetails job={job} earlyEnabled={earlyEnabled} hasLLMKey={hasLLMKey} deepDiveAccess={deepDiveAccess} />
        </Section>

        <Section
          title="Application history and contacts"
          summary={[
            history.events.length ? `${history.events.length} event${history.events.length === 1 ? '' : 's'}` : null,
            history.contacts.length ? `${history.contacts.length} contact${history.contacts.length === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' · ') || undefined}
        >
          <HistoryDetails job={job} history={history} />
        </Section>

        {spend && (spend.yourKey.requests > 0 || spend.appBilled.requests > 0) && (
          <Section title="AI spend on this job">
            <div className="max-w-sm"><JobSpendCard spend={spend} /></div>
          </Section>
        )}
      </div>
    </div>
  )
}

function Fact({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex h-5 items-center gap-1 text-xs text-muted-foreground">
        {label}
        {action}
      </dt>
      <dd className="mt-1 text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

function Section({ title, summary, defaultOpen = false, children }: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-3 text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        {title}
        {summary && <span className="text-xs font-normal text-muted-foreground">{summary}</span>}
      </summary>
      <div className="pb-6 pl-6">{children}</div>
    </details>
  )
}

function fitStrengthLabel(rating: number): string {
  if (rating >= 8) return "Strong match"
  if (rating >= 6) return "Good match"
  return "Partial match"
}

/** @deprecated JobFit (Claude) is superseded by the early assessment; shown only for reference or while that is off. */
function LegacyJobFit({ job, hasLLMKey }: { job: Job; hasLLMKey: boolean }) {
  return (
    <>
      <JobFit
        jobId={job.id}
        jobFit={job.jobFit ?? null}
        canAssess={!!job.jobDescription?.trim()}
        hasLLMKey={hasLLMKey}
        deepDive={job.deepDive}
        company={job.company ?? undefined}
        jdSnippet={job.jobDescription ? job.jobDescription.slice(0, 800) : undefined}
      />
      {job.jobFit && (
        <p className="text-xs text-muted-foreground">{fitStrengthLabel(job.jobFit.rating)}</p>
      )}
    </>
  )
}

/** What the old hub sidebar's Fit score and Deep dive cards held. */
function FitDetails({ job, earlyEnabled, hasLLMKey, deepDiveAccess }: {
  job: Job
  earlyEnabled: boolean
  hasLLMKey: boolean
  deepDiveAccess: ReturnType<typeof toDeepDiveAccess>
}) {
  const early = job.earlyAssessment ?? null
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Fit score</p>
        {earlyEnabled ? (
          <>
            <EarlyAssessment jobId={job.id} assessment={early} enabled deepDive={job.deepDive} deepDiveAccess={deepDiveAccess} />
            {/* JobFit is deprecated: kept for reference until it's removed. */}
            {job.jobFit && (
              <details className="mt-1 border-t pt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Legacy fit score (deprecated)
                </summary>
                <div className="mt-2 space-y-1">
                  <LegacyJobFit job={job} hasLLMKey={hasLLMKey} />
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            {job.jobFit
              ? <LegacyJobFit job={job} hasLLMKey={hasLLMKey} />
              : <p className="text-xs text-muted-foreground">No fit score yet. A Deep Dive gives a full verdict.</p>}
            {early && (
              <div className="mt-1 space-y-1 border-t pt-3">
                <p className="text-xs text-muted-foreground">Early assessment</p>
                <EarlyAssessment jobId={job.id} assessment={early} enabled={false} deepDive={job.deepDive} deepDiveAccess={deepDiveAccess} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Deep Dive</p>
        <DeepDiveEntry jobId={job.id} deepDive={job.deepDive ?? null} access={deepDiveAccess} />
      </div>
    </div>
  )
}

function HistoryDetails({ job, history }: {
  job: Job
  history: Awaited<ReturnType<typeof getJobContactsAndEvents>>
}) {
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact label="Progress"><span className="capitalize">{job.progress}</span></Fact>
        <Fact label="Applied">{formatDate(job.dateApplied, 'Not recorded')}</Fact>
        <Fact label="Last updated">{formatDate(job.lastUpdated, '—')}</Fact>
      </dl>

      {history.events.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">Events</h3>
          <ul className="space-y-2 text-sm">
            {history.events.map((event) => (
              <li key={event.id} className="min-w-0">
                <span className="font-medium">{event.title}</span>
                <span className="text-muted-foreground">
                  {' · '}{event.type}
                  {' · '}{formatDate(event.completedAt ?? event.scheduledAt ?? event.createdAt)}
                  {event.completedAt ? ' (done)' : event.scheduledAt ? ' (scheduled)' : ''}
                </span>
                {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.contacts.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">Contacts</h3>
          <ul className="space-y-2 text-sm">
            {history.contacts.map((contact) => (
              <li key={contact.id} className="min-w-0 break-words">
                <span className="font-medium">{contact.name}</span>
                {contact.role && <span className="text-muted-foreground"> · {contact.role}</span>}
                {contact.email && (
                  <> · <a href={`mailto:${contact.email}`} className="underline underline-offset-2">{contact.email}</a></>
                )}
                {contact.linkedIn && (
                  <> · <a href={contact.linkedIn} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">LinkedIn</a></>
                )}
                {contact.notes && <p className="text-xs text-muted-foreground">{contact.notes}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.events.length === 0 && history.contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">No events or contacts recorded for this job.</p>
      )}
    </div>
  )
}
