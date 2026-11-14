import { cookies } from 'next/headers'
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JOB_APPLICATIONS_DESCRIPTION } from './_components/job-list-layout'
import { ApplicationTabs } from './_components/application-tabs'
import { JobList } from "./_components/job-list"
import { ArchivedTab } from "./_components/archived-tab"
import { getActiveJobs } from "@/modules/jobs/queries"
import { ContentContainer } from "@/app/components/ContentContainer"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { toDeepDiveAccess } from "@/modules/deep-dive/access"
import { isEarlyAssessmentEnabled } from "@/modules/job-assessment/queries"

// Server Actions on this page queue the early job assessment and start deep
// dives, which run in after() within this limit; keep in sync with
// ROUTE_MAX_DURATION_S (src/modules/job-assessment/queue.ts) and
// DEEP_DIVE_ROUTE_MAX_DURATION_S (src/modules/deep-dive/schema.ts).
export const maxDuration = 300

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>
}) {
  const [jobs, { profile }, { create }, cookieStore] = await Promise.all([
    getActiveJobs(),
    requireProfile(),
    searchParams,
    cookies(),
  ])
  const [llmConfig, earlyEnabled] = await Promise.all([
    getLLMConfigStatus(profile.id),
    isEarlyAssessmentEnabled(profile.id),
  ])
  const hasLLMKey = llmConfig.configured

  return (
    <ContentContainer fullWidth compactHeaderOnMobile title="Job Applications" description={JOB_APPLICATIONS_DESCRIPTION}>
      <ApplicationTabs initialTab={create !== '1' && cookieStore.get('jobs-tab')?.value === 'archived' ? 'archived' : 'active'}>
        <TabsList className="mb-1 min-h-[50px] w-full md:mb-3 md:min-h-0 md:w-fit">
          <TabsTrigger value="active" className="min-h-11 text-base md:min-h-0 md:text-sm">Active</TabsTrigger>
          <TabsTrigger value="archived" className="min-h-11 text-base md:min-h-0 md:text-sm">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <JobList
            jobs={jobs}
            hasLLMKey={hasLLMKey}
            deepDiveAccess={toDeepDiveAccess(llmConfig)}
            earlyEnabled={earlyEnabled}
          />
        </TabsContent>
        <TabsContent value="archived">
          <ArchivedTab />
        </TabsContent>
      </ApplicationTabs>
    </ContentContainer>
  )
}
