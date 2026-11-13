import { ContentContainer } from '@/app/components/ContentContainer'
import { Skeleton } from '@/components/ui/skeleton'
import { JOB_APPLICATIONS_DESCRIPTION, JOB_LIST_COLUMNS } from './_components/job-list-layout'

export default function Loading() {
  return (
    <ContentContainer fullWidth title="Job Applications" description={JOB_APPLICATIONS_DESCRIPTION}>
      <div role="status" aria-label="Loading job applications" className="@container">
        <span className="sr-only">Loading job applications…</span>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="mb-3 h-8 w-32" />
          <div className="mt-2 border-t border-accent pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-full sm:w-80" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
              <div className="ml-auto flex gap-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-28" />
              </div>
            </div>
            <Skeleton className="mt-2 h-3 w-16" />
            <div className="my-3 border-t border-border" />

            <div className={`hidden @5xl:grid ${JOB_LIST_COLUMNS}`}>
              <div className="col-span-full grid grid-cols-subgrid items-center border-b border-border/50 py-1.5">
                <Skeleton className="mx-auto size-4" />
                <Skeleton className="mx-3 h-3 w-12" />
                <Skeleton className="mx-2 h-3 w-20" />
                <Skeleton className="mx-2 h-3 w-8" />
                <Skeleton className="mx-2 h-3 w-12" />
                <div />
              </div>
              <div className="col-span-full border-b border-border/30 px-3 py-2">
                <Skeleton className="h-3 w-28" />
              </div>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="col-span-full grid grid-cols-subgrid items-center border-b border-l-2 border-border/30 py-3">
                  <Skeleton className="mx-auto size-4" />
                  <div className="min-w-0 space-y-2 px-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-5 w-2/3" />
                  </div>
                  <div className="space-y-3 px-2">
                    <Skeleton className="h-7 w-28" />
                    <Skeleton className="h-2 w-28" />
                  </div>
                  <Skeleton className="mx-2 h-5 w-24" />
                  <div className="space-y-2 px-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <div className="flex justify-end gap-1 px-2">
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 @5xl:hidden">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="space-y-3 rounded-md border border-border/30 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex gap-3">
                    <Skeleton className="h-7 w-28" />
                    <Skeleton className="h-7 w-24" />
                  </div>
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ContentContainer>
  )
}
