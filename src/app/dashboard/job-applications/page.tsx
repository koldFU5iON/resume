import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  searchParams: Promise<{ create?: string; url?: string }>
}) {
  const [jobs, { profile }, { create, url }] = await Promise.all([
    getActiveJobs(),
    requireProfile(),
    searchParams,
  ])
  const [llmConfig, earlyEnabled] = await Promise.all([
    getLLMConfigStatus(profile.id),
    isEarlyAssessmentEnabled(profile.id),
  ])
  const hasLLMKey = llmConfig.configured

  return (
    <ContentContainer fullWidth title="Job Applications" description="Track all the jobs you're currently interested in. Update the status to keep up to date on the current process and where you stand with your application">
      <Tabs defaultValue="active" className="w-full">
        <TabsList className="mb-3">
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <JobList
            jobs={jobs}
            hasLLMKey={hasLLMKey}
            deepDiveAccess={toDeepDiveAccess(llmConfig)}
            earlyEnabled={earlyEnabled}
            openCreate={create === '1'}
            initialCreateUrl={url}
          />
        </TabsContent>
        <TabsContent value="archived">
          <ArchivedTab />
        </TabsContent>
      </Tabs>
    </ContentContainer>
  )
}
