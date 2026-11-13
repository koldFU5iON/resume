import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ApplicationStatusType } from "@/app/types/job-application"
import type { DashboardStats } from "@/modules/jobs/queries"

const FUNNEL_ORDER: ApplicationStatusType[] = [
  'not started',
  'in-progress',
  'applied',
  'interviewing',
]

const STATUS_LABEL: Record<ApplicationStatusType, string> = {
  'not started':       'Not started',
  'in-progress':       'Preparing',
  'applied':           'Applied',
  'interviewing':      'Interviewing',
  'accepted':          'Accepted',
  'rejected':          'Rejected',
}

const STATUS_BAR: Record<ApplicationStatusType, string> = {
  'not started':  'bg-slate-300 dark:bg-slate-600',
  'in-progress':  'bg-sky-400 dark:bg-sky-500',
  'applied':      'bg-violet-400 dark:bg-violet-500',
  'interviewing': 'bg-emerald-400 dark:bg-emerald-500',
  'accepted':     'bg-green-500',
  'rejected':     'bg-red-400',
}

type Props = Pick<DashboardStats, 'byStatus' | 'totalActive'>

export function PipelineCard({ byStatus, totalActive }: Props) {
  const maxCount = Math.max(1, ...FUNNEL_ORDER.map(s => byStatus[s] ?? 0))

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Pipeline</CardTitle>
          <Link
            href="/dashboard/job-applications"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {totalActive === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No active applications yet.{" "}
            <Link href="/dashboard/job-applications?create=1" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Add your first job
            </Link>
          </p>
        ) : (
          FUNNEL_ORDER.map(status => {
            const count = byStatus[status] ?? 0
            const pct = count > 0 ? `max(6px, ${Math.round((count / maxCount) * 100)}%)` : '0px'
            return (
              <div key={status} className="flex items-center gap-3">
                <span className="w-[88px] shrink-0 text-xs text-muted-foreground">
                  {STATUS_LABEL[status]}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-300", STATUS_BAR[status])}
                    style={{ width: pct }}
                  />
                </div>
                <span className={cn(
                  "w-4 shrink-0 text-right text-xs font-medium tabular-nums",
                  count === 0 && "text-muted-foreground",
                )}>
                  {count}
                </span>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
