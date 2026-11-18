import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  Archive,
  FileText,
  Inspect,
  LucideIcon,
  Mail,
  MoreHorizontal,
  NotebookPen,
  Pencil
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeprecatingSoonBadge } from "@/components/legacy-editors/deprecation"

/** The links the job menu keeps for documents made by the legacy editors. There is no "Generate" entry: the writing desk makes new ones. */
export function legacyDocumentLinks({ cvDocumentId, coverLetterDocumentId }: { cvDocumentId?: string | null; coverLetterDocumentId?: string | null }): Array<{ label: string; href: string }> {
  return [
    ...(cvDocumentId ? [{ label: "View CV", href: `/dashboard/cv-builder/${cvDocumentId}` }] : []),
    ...(coverLetterDocumentId ? [{ label: "View Cover Letter", href: `/dashboard/cover-letters/${coverLetterDocumentId}` }] : []),
  ]
}

type AppControlsProps = {
  id: string
  className?: string
  cvDocumentId?: string | null
  coverLetterDocumentId?: string | null
  onEdit?: () => void
  onArchive?: () => void
}

export function AppControls({ id, className, cvDocumentId, coverLetterDocumentId, onEdit, onArchive }: AppControlsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Job actions"
        className={cn("flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 max-w-[calc(100vw-1rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Quick Actions</DropdownMenuLabel>
          <AppControlsItem
            Icon={Inspect}
            label="View"
            action={`/dashboard/job-applications/view/${id}`}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">File Management</DropdownMenuLabel>
          {/* CVs and cover letters are made in the writing desk; only an existing
              legacy document keeps a link here until the legacy editors are removed. */}
          {legacyDocumentLinks({ cvDocumentId, coverLetterDocumentId }).map(link => (
            <AppControlsItem key={link.label} Icon={link.label === "View CV" ? FileText : Mail} label={link.label} deprecated action={link.href} />
          ))}
          <AppControlsItem
            Icon={NotebookPen}
            label="Writing desk"
            action={`/dashboard/job-applications/view/${id}/writing`}
          />
          <AppControlsItem
            Icon={Pencil}
            label="Edit"
            onSelect={onEdit}
            disabled={!onEdit}
          />
          <AppControlsItem
            Icon={Archive}
            label="Archive"
            onSelect={onArchive}
            disabled={!onArchive}
          />
        </DropdownMenuGroup>

      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type AppControlsItemProps = {
  Icon: LucideIcon
  label: string
  /** Opens a legacy editor that Writing Desk documents replace (#379). */
  deprecated?: boolean
  action?: string
  onSelect?: () => void
  disabled?: boolean
}

function AppControlsItem({ Icon, label, deprecated, action, onSelect, disabled }: AppControlsItemProps) {
  const content = (
    <>
      <Icon className="size-4" />
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {deprecated && <DeprecatingSoonBadge />}
    </>
  )

  if (action && !disabled) {
    return (
      <Link href={action}>
        <DropdownMenuItem className="cursor-pointer">
          {content}
        </DropdownMenuItem>
      </Link>
    )
  }

  // base-ui Menu.Item dispatches keyboard activation as onClick (unlike Radix's onSelect)
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={onSelect}
      className={cn("max-md:min-h-11", !disabled && "cursor-pointer")}
    >
      {content}
    </DropdownMenuItem>
  )
}
