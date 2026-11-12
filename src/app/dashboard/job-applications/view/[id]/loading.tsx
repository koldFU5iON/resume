import { Skeleton } from "@/components/ui/skeleton"

// Job Description placeholder; the workspace header and navigation stay
// in place from the layout while it loads.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-8 md:py-8">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
      <div className="max-w-[72ch] space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${90 - (i % 3) * 12}%` }} />
        ))}
      </div>
    </div>
  )
}
