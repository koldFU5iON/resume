"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, ClipboardList, FileText, Mail, MessageSquare, NotebookPen, Plus, type LucideIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { JobWorkspace } from "@/modules/jobs/queries"
import {
  activeJobDocument,
  isJobDeepDivePath,
  jobDeepDiveHref,
  jobDocumentCreateLinks,
  jobDocumentLinks,
  type JobDocumentCreateLink,
  type JobDocumentKind,
} from "@/modules/jobs/workspace-nav"

const DOCUMENT_ICON: Record<JobDocumentKind, LucideIcon> = {
  description: ClipboardList,
  "writing-desk": NotebookPen,
  cv: FileText,
  "cover-letter": Mail,
  "interview-prep": MessageSquare,
}

/**
 * The job's documents as route links (each keeps its existing editor), with
 * the current one marked. Tablet and desktop get a tab strip that scrolls
 * sideways when it runs out of room; phones get a document selector.
 */
export function JobDocumentNav({ workspace }: { workspace: JobWorkspace }) {
  const pathname = usePathname()
  const router = useRouter()
  const links = jobDocumentLinks(workspace.assets)
  const createLinks = jobDocumentCreateLinks(workspace.assets)
  const active = activeJobDocument(pathname, links)
  const deepDiveHref = jobDeepDiveHref(workspace.jobId)
  const selected = active
    ? links.find((l) => l.kind === active)!.href
    : isJobDeepDivePath(pathname, workspace.jobId) ? deepDiveHref : ""

  return (
    <nav aria-label="Job documents" className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 md:h-11 md:px-4 print:hidden">
      <ul className="hidden h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:thin] md:flex">
        {links.map((link) => {
          const Icon = DOCUMENT_ICON[link.kind]
          const current = active === link.kind
          return (
            <li key={link.kind} className="flex">
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                title={link.detail ? `${link.label} · ${link.detail}` : undefined}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-sm px-2.5 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full",
                  current && "text-foreground after:bg-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {link.label}
                {link.detail && <span className="text-muted-foreground">· {link.detail}</span>}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="relative flex min-w-0 flex-1 md:hidden">
        <select
          aria-label="Current document"
          value={selected}
          onChange={(event) => { if (event.target.value) router.push(event.target.value) }}
          className="h-9 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-background pr-8 pl-2.5 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {!selected && <option value="" disabled>Choose a document</option>}
          {links.map((link) => (
            <option key={link.kind} value={link.href}>
              {link.detail ? `${link.label} · ${link.detail}` : link.label}
            </option>
          ))}
          <option value={deepDiveHref}>Deep Dive</option>
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>

      {createLinks.length > 0 && <AddDocumentMenu links={createLinks} />}
    </nav>
  )
}

/**
 * Existing creation flows for the job's missing assets. Creating further
 * named Writing Desk documents is Phase 3 (#371); nothing here pretends to.
 */
function AddDocumentMenu({ links }: { links: JobDocumentCreateLink[] }) {
  const router = useRouter()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Add a document"
        title="Add a document"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-9 shrink-0 md:size-8")}
      >
        <Plus aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add to this job</DropdownMenuLabel>
          {links.map((link) => {
            const Icon = DOCUMENT_ICON[link.kind]
            return (
              <DropdownMenuItem key={link.kind} onClick={() => router.push(link.href)}>
                <Icon aria-hidden="true" />
                {link.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
