import { Skeleton } from '@/components/ui/skeleton'
import { ContentContainer } from '@/app/components/ContentContainer'

export default function Loading() {
  return (
    <ContentContainer title="Job Hunt" description="Scan companies and job boards, then review matched roles." fullWidth>
      <div className="@container">
        {/* Criteria + scan status */}
        <Skeleton className="h-24 w-full rounded-lg mb-8" />

        <div className="grid items-start gap-x-10 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Discovered roles */}
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-4 w-32 rounded opacity-60" />
            <div className="mt-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" style={{ opacity: 1 - i * 0.15 }} />
              ))}
            </div>
          </div>

          {/* Sources: watched companies, job boards */}
          <div className="grid items-start gap-10 @2xl:grid-cols-2 @4xl:grid-cols-1">
            {[36, 32].map((w) => (
              <div key={w} className="space-y-2">
                <Skeleton className="h-4 rounded" style={{ width: `${w * 4}px` }} />
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" style={{ opacity: 1 - i * 0.2 }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ContentContainer>
  )
}
