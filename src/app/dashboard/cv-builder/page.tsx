// src/app/dashboard/cv-builder/page.tsx
import Link from "next/link"
import { requireProfile } from "@/lib/session"
import { listCVs } from "@/modules/cv/queries"
import { getCareerVertical } from "@/modules/career-vertical/queries"
import { ContentContainer } from "@/app/components/ContentContainer"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileText, Plus, Target } from "lucide-react"
import { formatDate } from "@/lib/utils"

export default async function CVBuilderPage() {
  const { profile } = await requireProfile()
  const [cvs, careerVertical] = await Promise.all([
    listCVs(profile.id),
    getCareerVertical(profile.id),
  ])

  return (
    <ContentContainer
      title="CV Builder"
      description="Create and manage your CVs. Generate a tailored CV from any job application, or build a master CV to share with recruiters."
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        {!careerVertical && (
          <Link
            href="/dashboard/career-vertical"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          >
            <Target className="mr-1.5 size-4" />
            Define career vertical
          </Link>
        )}
        <Link href="/dashboard/cv-builder/new" className={cn(buttonVariants({ size: "sm" }))}>
          <Plus className="mr-1.5 size-4" />
          New CV
        </Link>
      </div>

      {cvs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <FileText className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No CVs yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Generate a tailored CV from a job application, or create a master CV.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {cvs.map(cv => (
            <Link
              key={cv.id}
              href={`/dashboard/cv-builder/${cv.id}`}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <FileText className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {cv.jobTitle && cv.company
                      ? `${cv.jobTitle} · ${cv.company}`
                      : "Master CV"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {cv.careerVerticalId
                      ? "Career vertical master · "
                      : cv.jobApplicationId
                        ? "Job-specific · "
                        : "Generic · "}
                    Updated {formatDate(cv.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cv.stale && (
                  <span
                    className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400"
                    title="The master CV changed since this was tailored"
                  >
                    Master changed
                  </span>
                )}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {cv.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </ContentContainer>
  )
}
