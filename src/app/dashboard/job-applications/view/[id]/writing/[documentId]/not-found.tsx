"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { buttonVariants } from "@/components/ui/button"
import { jobHubHref } from "@/modules/jobs/workspace-nav"

/**
 * A document link that no longer opens anything: deleted (#377), or not this
 * job's. The job's header and tabs stay above it, so the other documents are
 * one click away.
 */
export default function DocumentNotFound() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">Document not found</h1>
        <p className="text-sm text-muted-foreground">
          This document doesn&apos;t exist. It may have been deleted. The job&apos;s other documents are in the tabs above.
        </p>
        <Link href={jobHubHref(id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open Job Description
        </Link>
      </div>
    </div>
  )
}
