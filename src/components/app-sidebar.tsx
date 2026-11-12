'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChevronsUpDown,
  Coins,
  LogOut,
  MessageSquareWarning,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  User,
} from "lucide-react"
import { useTheme } from "next-themes"
import Link from "next/link"
import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { authClient, useSession } from "@/lib/auth-client"
import { navGroups, type NavItem } from "@/lib/nav-menu"
import { brand } from "@/lib/brand"
import { FeedbackDrawer } from "@/app/components/FeedbackDrawer"
import { Wordmark } from "@/components/brand/wordmark"
import { CurrntIcon } from "@/components/brand/icon"
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog"
import { Support } from "./support"
import { cn } from "@/lib/utils"
import { usePageContext } from "@/lib/context/page-context"
import type { ActiveJobForNav } from "@/modules/jobs/queries"

export function AppSidebar({ activeJobs, suggestionCount }: { activeJobs: ActiveJobForNav[]; suggestionCount: number }) {
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarUtilities />

        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavMenuItem
                    key={item.destination}
                    {...item}
                    badge={item.destination === '/dashboard/search-context' && suggestionCount > 0 ? suggestionCount : undefined}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Active Jobs</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {activeJobs.length === 0 ? (
                <SidebarMenuItem>
                  <p className="px-3 py-2 text-xs text-muted-foreground">No active jobs</p>
                </SidebarMenuItem>
              ) : (
                activeJobs.map(job => <ActiveJobMenuItem key={job.id} job={job} />)
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <CoachButton />
          <ThemeButton />
          <FeedbackButton />
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

/** Closes the phone drawer; a no-op on desktop. */
function useCloseMobileSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()
  return () => { if (isMobile) setOpenMobile(false) }
}

/**
 * currnt home link and the sidebar toggle, as two separate targets (#369).
 * Collapsed (icon mode) they stack vertically so neither covers the other.
 * In the phone drawer the toggle closes the drawer.
 */
function SidebarBrand() {
  const { isMobile, state, toggleSidebar } = useSidebar()
  const closeMobile = useCloseMobileSidebar()
  const expanded = state === "expanded"
  const toggleLabel = isMobile ? "Close navigation" : expanded ? "Collapse sidebar" : "Expand sidebar"
  const ToggleIcon = isMobile || expanded ? PanelLeftClose : PanelLeftOpen

  return (
    <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
      <Link
        href="/dashboard"
        onClick={closeMobile}
        aria-label={`${brand.name} home`}
        title={`${brand.name} home`}
        className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pr-0"
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          <CurrntIcon size={22} />
        </span>
        <Wordmark size="sm" className="group-data-[collapsible=icon]:hidden" />
      </Link>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={toggleLabel}
        aria-expanded={isMobile ? true : expanded}
        title={isMobile ? toggleLabel : `${toggleLabel} (Ctrl+B)`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&_svg]:size-4"
      >
        <ToggleIcon aria-hidden="true" />
      </button>
    </div>
  )
}

/** Search and Add job: global utilities that used to live in the top bar. */
function SidebarUtilities() {
  const { setPaletteOpen, setAddJobOpen } = usePageContext()
  const closeMobile = useCloseMobileSidebar()

  return (
    <SidebarGroup className="pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search or jump to (Ctrl+K)"
              onClick={() => { closeMobile(); setPaletteOpen(true) }}
              className="border border-sidebar-border text-sidebar-foreground/70 group-data-[collapsible=icon]:border-transparent"
            >
              <Search />
              <span className="flex-1">Search or jump to…</span>
              <kbd className="pointer-events-none hidden shrink-0 items-center rounded border border-sidebar-border bg-sidebar px-1 font-mono text-[10px] font-medium md:inline-flex">
                ⌘K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Add job" onClick={() => { closeMobile(); setAddJobOpen(true) }}>
              <Plus />
              <span>Add job</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function CoachButton() {
  const { chatOpen, togglePanel } = usePageContext()
  const closeMobile = useCloseMobileSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={chatOpen}
        aria-pressed={chatOpen}
        tooltip="Career Coach (Ctrl+L)"
        onClick={() => { closeMobile(); togglePanel() }}
      >
        <Sparkles />
        <span>Career Coach</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  // Both labels and icons render; CSS shows the right pair, so server and
  // client markup match without a mounted guard.
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Switch theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        <Moon className="dark:hidden" />
        <Sun className="hidden dark:block" />
        <span className="dark:hidden">Switch to dark</span>
        <span className="hidden dark:inline">Switch to light</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function ActiveJobMenuItem({ job }: { job: ActiveJobForNav }) {
  const pathname = usePathname()
  const closeMobile = useCloseMobileSidebar()
  const { context } = usePageContext()
  // highlight if on this job's hub page OR if the page context has this job's ID
  const contextJobId = context && 'jobId' in context ? context.jobId : undefined
  const isActive =
    pathname.startsWith(`/dashboard/job-applications/view/${job.id}`) ||
    contextJobId === job.id

  const statusColour = job.status === 'interviewing'
    ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
    : 'bg-amber-500/20 text-amber-600 dark:text-amber-500'

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={job.company ? `${job.company} — ${job.title}` : job.title}
        render={<Link href={`/dashboard/job-applications/view/${job.id}`} onClick={closeMobile} />}
      >
        <span className="min-w-0 flex-1 truncate text-xs">
          {job.company ? `${job.company} · ` : ''}{job.title}
        </span>
        <span className={cn('shrink-0 rounded px-1 py-0.5 text-[10px] font-medium', statusColour)}>
          {job.status === 'interviewing' ? 'interview' : 'progress'}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function FeedbackButton() {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <SidebarMenuItem>
        <Dialog>
          <DialogTrigger
            render={
              <SidebarMenuButton tooltip="Support currnt development">
                <Coins />
                <span>Support currnt</span>
              </SidebarMenuButton>
            }
          />
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <Support className="px-2 py-4" />
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>

      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => setFeedbackOpen(true)} tooltip="Report an issue">
          <MessageSquareWarning />
          <span>Report an issue</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <FeedbackDrawer open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}

function NavMenuItem({ destination, label, Icon, badge }: NavItem & { badge?: number }) {
  const pathname = usePathname()
  const closeMobile = useCloseMobileSidebar()
  const isActive =
    destination === "/dashboard"
      ? pathname === destination
      : pathname.startsWith(destination)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} tooltip={label} render={<Link href={destination} onClick={closeMobile} />}>
        <Icon />
        <span>{label}</span>
        {badge && badge > 0 && (
          <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function UserMenu() {
  const router = useRouter()
  const { data: session, isPending } = useSession()

  const handleSignOut = async () => {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  const name = session?.user.name ?? (isPending ? "Loading..." : "Signed out")
  const email = session?.user.email ?? ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton size="lg" tooltip={name}>
            <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-muted">
              <User className="size-4" />
            </div>
            <div className="flex flex-col text-left flex-1 overflow-hidden">
              <span className="font-medium text-sm truncate">{name}</span>
              {email && <span className="text-xs text-muted-foreground truncate">{email}</span>}
            </div>
            <ChevronsUpDown className="size-4 ml-auto" />
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <Link href="/dashboard/settings">
            <DropdownMenuItem className="cursor-pointer">
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem disabled>
            <User className="size-4" />
            Profile
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
