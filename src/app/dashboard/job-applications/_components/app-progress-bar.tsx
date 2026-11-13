'use client'

import { useTransition } from "react"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"
import clsx from "clsx";
import React from "react";
import { ApplicationProgress, ApplicationProgressType } from "@/app/types/job-application";
import { updateJobProgress } from "@/modules/jobs/mutations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const stages = Object.values(ApplicationProgress)

type NodeState = "past" | "active" | "future"

export function AppProgressBar({
  progress,
  jobId,
  compact = false,
  textOnly = false,
}: {
  progress: ApplicationProgressType
  jobId: string
  compact?: boolean
  textOnly?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const activeIndex = stages.indexOf(progress)

  function handleSelect(stage: ApplicationProgressType) {
    if (stage === progress) return
    startTransition(async () => {
      try {
        await updateJobProgress(jobId, stage)
      } catch {
        toast.error('Could not update progress. Please try again.')
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        aria-label={`Application progress: ${progress}`}
        className={clsx("flex min-h-8 justify-center cursor-pointer", textOnly ? "min-h-11 flex-row items-center gap-2 rounded-md border border-border px-3 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "flex-col", compact ? "items-start" : "items-center")}
      >
        {textOnly ? <><span>Progress: {progress}</span><ChevronDown className="size-4" /></> : <>
        <span className={compact ? "sr-only" : "text-xs text-muted-foreground"}>Progress</span>
        <div className="flex items-center w-28">
          {stages.map((stage, index) => {
            const state: NodeState = index < activeIndex ? "past" : index === activeIndex ? "active" : "future"
            return (
              <React.Fragment key={stage}>
                <AppProgressBarNode state={state} />
                {index < stages.length - 1 && (
                  <AppProgressBarConnector filled={index < activeIndex} />
                )}
              </React.Fragment>
            )
          })}
        </div>
        </>}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          {stages.map((stage) => (
            <DropdownMenuItem
              key={stage}
              onClick={() => handleSelect(stage)}
              className={clsx("capitalize max-md:min-h-11", stage === progress && "font-semibold")}
            >
              {stage}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppProgressBarNode({ state }: { state: NodeState }) {
  return (
    <div className="relative flex items-center justify-center size-3">
      {state === "active" && (
        <div className="absolute inset-0 rounded-full bg-green-500 motion-safe:animate-ping opacity-40" />
      )}
      <div className={clsx(
        "size-3 rounded-full border transition-colors duration-300",
        {
          "bg-primary border-primary": state === "past",
          "bg-green-500 border-green-500": state === "active",
          "bg-background border-border": state === "future",
        }
      )} />
    </div>
  )
}

function AppProgressBarConnector({ filled }: { filled: boolean }) {
  return (
    <div className={clsx(
      "flex-1 h-0.5 transition-colors duration-300",
      filled ? "bg-primary" : "bg-border"
    )} />
  )
}
