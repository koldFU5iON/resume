import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Small display pieces shared by the fit pills (JobFit, EarlyAssessment):
 * the pill shell, the 0–10 gauge and the detail header above it.
 */

export function ScorePill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap", className)}>
      {children}
    </span>
  )
}

/** Horizontal 0–10 gauge; `colorClass` is the fill's background class. */
export function ScoreGauge({ rating, colorClass }: { rating: number; colorClass: string }) {
  const width = Math.min(10, Math.max(0, rating)) * 10
  return (
    <div className="mb-3 flex items-center gap-1.5">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", colorClass)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

/** Title on the left, "7/10" on the right, gauge underneath (the FitDetail layout). */
export function ScoreHeader({ title, rating, colorClass, titleClassName }: {
  title: string
  rating: number
  colorClass: string
  titleClassName?: string
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className={cn("text-sm font-semibold capitalize", titleClassName)}>{title}</p>
        <span className="font-mono text-xs text-muted-foreground">{rating}/10</span>
      </div>
      <ScoreGauge rating={rating} colorClass={colorClass} />
    </>
  )
}
