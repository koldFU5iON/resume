"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ClipboardList, FileText, Mail, MessageSquare, NotebookPen, Plus, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { JobWorkspace } from "@/modules/jobs/queries"
import {
  activeJobDocument,
  canAddWritingDeskDocument,
  isJobDeepDivePath,
  jobDeepDiveHref,
  jobDocumentCreateLinks,
  jobDocumentLinks,
  unlistedWritingDeskDocument,
  type JobDocumentKind,
} from "@/modules/jobs/workspace-nav"
import { MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from "@/modules/writing-desk/schema"
import { DEPRECATING_SOON, DeprecatingSoonBadge } from "@/components/legacy-editors/deprecation"
import { DocumentSwitcher, type SwitcherEntry } from "./document-switcher"
import { NewDocumentDialog } from "./new-document-dialog"

const DOCUMENT_ICON: Record<JobDocumentKind, LucideIcon> = {
  description: ClipboardList,
  "writing-desk": NotebookPen,
  cv: FileText,
  "cover-letter": Mail,
  "interview-prep": MessageSquare,
}

const AT_CAP_MESSAGE = `This job has ${MAX_WRITING_DESK_DOCUMENTS_PER_JOB} documents, the most a job can hold. Delete one you no longer need to make room.`

/**
 * The job's documents as route links (each keeps its own editor), with the
 * current one marked, then "+" for a new document (#371). Tablet and desktop
 * get a tab strip that scrolls sideways when it runs out of room, plus an
 * "All documents" list with search; phones get that list as the document
 * selector.
 */
export function JobDocumentNav({ workspace }: { workspace: JobWorkspace }) {
  const pathname = usePathname()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const stripRef = useRef<HTMLUListElement>(null)
  const activeTabRef = useRef<HTMLLIElement>(null)
  const refreshedFor = useRef<string | null>(null)

  const { assets } = workspace
  const links = jobDocumentLinks(assets)
  const legacyCreateLinks = jobDocumentCreateLinks(assets)
  const deepDiveHref = jobDeepDiveHref(workspace.jobId)
  const active = activeJobDocument(pathname, links) ?? (isJobDeepDivePath(pathname, workspace.jobId) ? "deep-dive" : null)
  const entries: SwitcherEntry[] = [...links, { key: "deep-dive", kind: "deep-dive", label: "Deep Dive", href: deepDiveHref }]
  const canAdd = canAddWritingDeskDocument(assets)

  // A document opened before this (client-cached) layout knew about it: the
  // legacy /writing URL creating a job's first document, or one an agent
  // added. Refresh once so its tab appears, named.
  const unlisted = unlistedWritingDeskDocument(pathname, assets)
  useEffect(() => {
    if (!unlisted || refreshedFor.current === unlisted) return
    refreshedFor.current = unlisted
    router.refresh()
  }, [unlisted, router])

  // Keep the open document's tab in view when the strip overflows. Scrolls
  // the strip only: scrollIntoView would also move the page.
  useEffect(() => {
    const strip = stripRef.current
    const tab = activeTabRef.current
    if (!strip || !tab) return
    const left = tab.offsetLeft - strip.offsetLeft
    const right = left + tab.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [active])

  return (
    <nav aria-label="Job documents" className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 md:h-11 md:px-4 print:hidden">
      <ul ref={stripRef} className="hidden h-full w-0 min-w-0 max-w-fit flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:thin] md:flex">
        {links.map((link) => {
          const Icon = DOCUMENT_ICON[link.kind]
          const current = active === link.key
          return (
            <li key={link.key} ref={current ? activeTabRef : undefined} className="flex shrink-0">
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                title={[link.label, link.detail, link.deprecated && DEPRECATING_SOON].filter(Boolean).join(" · ")}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-sm px-2.5 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full",
                  current && "text-foreground after:bg-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-48 truncate">{link.label}</span>
                {link.detail && <span className="text-muted-foreground">· {link.detail}</span>}
                {link.deprecated && <DeprecatingSoonBadge className="ml-0.5" />}
              </Link>
            </li>
          )
        })}
      </ul>

      <DocumentSwitcher
        variant="selector"
        entries={entries}
        activeKey={active}
        legacyCreateLinks={legacyCreateLinks}
        icons={DOCUMENT_ICON}
        className="flex-1 md:hidden"
      />

      <button
        type="button"
        aria-label={canAdd ? "New document" : `New document. ${AT_CAP_MESSAGE}`}
        aria-disabled={canAdd ? undefined : true}
        title={canAdd ? "New document" : AT_CAP_MESSAGE}
        onClick={() => (canAdd ? setCreating(true) : toast.info(AT_CAP_MESSAGE))}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "size-9 shrink-0 md:size-8",
          !canAdd && "cursor-not-allowed opacity-50",
        )}
      >
        <Plus aria-hidden="true" />
      </button>

      <DocumentSwitcher
        variant="overflow"
        entries={entries}
        activeKey={active}
        legacyCreateLinks={legacyCreateLinks}
        icons={DOCUMENT_ICON}
        className="hidden md:ml-auto md:inline-flex"
      />

      {creating && (
        <NewDocumentDialog
          jobId={workspace.jobId}
          existingNames={assets.writingDesks.map((desk) => desk.name)}
          open
          onOpenChange={setCreating}
        />
      )}
    </nav>
  )
}
