"use client"

import Link from "next/link"
import { Menu, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { CurrntIcon } from "@/components/brand/icon"
import { Wordmark } from "@/components/brand/wordmark"
import { usePageContext } from "@/lib/context/page-context"
import { brand } from "@/lib/brand"

/**
 * Phone-only bar that keeps the navigation trigger reachable while the drawer
 * is closed. Desktop has no top bar: Search, Add job, Coach and theme live in
 * the sidebar. The job workspace header carries its own trigger, so the shell
 * hides this bar there (see AppShell).
 */
export function MobileTopBar() {
  const { setOpenMobile } = useSidebar()
  const { setPaletteOpen } = usePageContext()

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2 md:hidden print:hidden">
      <Button variant="ghost" size="icon-lg" onClick={() => setOpenMobile(true)} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>
      <Link
        href="/dashboard"
        aria-label={`${brand.name} home`}
        className="flex h-9 items-center gap-1.5 rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CurrntIcon size={20} />
        <Wordmark size="sm" />
      </Link>
      <Button
        variant="ghost"
        size="icon-lg"
        className="ml-auto"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search or jump to"
      >
        <Search className="size-5" />
      </Button>
    </header>
  )
}
