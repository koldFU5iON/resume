import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { AppShell } from '@/components/shell/app-shell'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { PageContextProvider } from '@/lib/context/page-context'
import { requireProfile } from '@/lib/session'
import { getActiveJobsForNav } from '@/modules/jobs/queries'
import { getSuggestionCount } from '@/modules/search-profile/queries'
import { getOnboardingStatus } from '@/modules/onboarding/queries'

// Quick capture (command bar, on every dashboard page) queues the early job
// assessment, which runs in after() within this limit; keep in sync with
// ROUTE_MAX_DURATION_S in src/modules/job-assessment/queue.ts.
export const maxDuration = 300

export default async function Layout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile()

  const onboardingStatus = await getOnboardingStatus(profile.id)
  if (!onboardingStatus.isComplete) redirect('/onboarding')

  const [activeJobs, suggestionCount] = await Promise.all([
    getActiveJobsForNav(profile.id),
    getSuggestionCount(profile.id),
  ])

  return (
    <SidebarProvider>
      <PageContextProvider>
        <AppSidebar activeJobs={activeJobs} suggestionCount={suggestionCount} />
        <SidebarInset>
          <AppShell>{children}</AppShell>
        </SidebarInset>
      </PageContextProvider>
    </SidebarProvider>
  )
}
