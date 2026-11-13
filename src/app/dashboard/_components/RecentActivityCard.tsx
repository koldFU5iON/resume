import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { daysAgo, formatRelative } from "@/lib/utils"
import { cn } from "@/lib/utils"
import type { ApplicationStatusType } from "@/app/types/job-application"
import type { DashboardJobSlim } from "@/modules/jobs/queries"

const STATUS_BADGE_VARIANT: Record<ApplicationStatusType, 'secondary' | 'info' | 'outline' | 'success' | 'destructive' | 'warning'> = {
  'not started':  'secondary',
  'in-progress':  'info',
  'applied':      'outline',
  'interviewing': 'success',
  'accepted':     'success',
  'rejected':     'destructive',
}

const STATUS_LABEL: Record<ApplicationStatusType, string> = {
  'not started':  'Not started',
  'in-progress':  'Preparing',
  'applied':      'Applied',
  'interviewing': 'Interviewing',
  'accepted':     'Accepted',
  'rejected':     'Rejected',
}

export function RecentActivityCard({ jobs }: { jobs: DashboardJobSlim[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Recently updated</CardTitle>
          <Link
            href="/dashboard/job-applications"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            All applications
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No applications yet.{" "}
            <Link href="/dashboard/job-applications?create=1" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Add your first job
            </Link>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {jobs.map(job => {
              const days = daysAgo(job.lastUpdated) ?? 0
              return (
                <Link
                  key={job.id}
                  href={`/dashboard/job-applications/view/${job.id}`}
                  className="group flex flex-col gap-1.5 rounded-lg border border-border p-3 hover:bg-muted transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge
                      variant={STATUS_BADGE_VARIANT[job.status]}
                      className="shrink-0"
                    >
                      {STATUS_LABEL[job.status]}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatRelative(days)}
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm font-medium leading-snug line-clamp-1",
                    "group-hover:text-foreground",
                  )}>
                    {job.company}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{job.title}</p>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
