import Link from "next/link"
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

type AppControlsProps = {
  id: string
  cvDocumentId?: string | null
  coverLetterDocumentId?: string | null
  onEdit?: () => void
  onArchive?: () => void
  onGenerateCV?: () => void
  onCreateCoverLetter?: () => void
}

export function AppControls({ id, cvDocumentId, coverLetterDocumentId, onEdit, onArchive, onGenerateCV, onCreateCoverLetter }: AppControlsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Job actions"
        className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          {cvDocumentId ? (
            <AppControlsItem
              Icon={FileText}
              label="View CV"
              deprecated
              action={`/dashboard/cv-builder/${cvDocumentId}`}
            />
          ) : (
            <AppControlsItem
              Icon={FileText}
              label="Generate CV"
              deprecated
              onSelect={onGenerateCV}
              action={onGenerateCV ? undefined : `/dashboard/cv-builder/new?jobId=${id}`}
            />
          )}
          {coverLetterDocumentId ? (
            <AppControlsItem
              Icon={Mail}
              label="View Cover Letter"
              deprecated
              action={`/dashboard/cover-letters/${coverLetterDocumentId}`}
            />
          ) : (
            <AppControlsItem
              Icon={Mail}
              label="Create Cover Letter"
              deprecated
              onSelect={onCreateCoverLetter}
              action={onCreateCoverLetter ? undefined : `/dashboard/cover-letters/new?jobId=${id}`}
            />
          )}
          <AppControlsItem
            Icon={NotebookPen}
            label="Open writing desk"
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
      className={!disabled ? "cursor-pointer" : ""}
    >
      {content}
    </DropdownMenuItem>
  )
}
