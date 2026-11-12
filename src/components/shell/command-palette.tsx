"use client"

import { useRouter } from "next/navigation"
import { guardedNavigate } from "@/components/job-workspace/navigation-guard"
import { useTheme } from "next-themes"
import { Settings, KeyRound, Plus, Sparkles, SunMoon, UserCog } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { mainNav } from "@/lib/nav-menu"
import { usePageContext } from "@/lib/context/page-context"

type SettingsItem = {
  destination: string
  label: string
  Icon: typeof Settings
}

const settingsNav: SettingsItem[] = [
  { destination: "/dashboard/settings", label: "Settings", Icon: Settings },
  { destination: "/dashboard/settings/account", label: "Account", Icon: UserCog },
  { destination: "/dashboard/settings/llm", label: "LLM Settings", Icon: Sparkles },
  { destination: "/dashboard/settings/api-tokens", label: "API Tokens", Icon: KeyRound },
]

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()
  const { togglePanel, setAddJobOpen } = usePageContext()
  const { resolvedTheme, setTheme } = useTheme()

  const go = (href: string) => {
    onOpenChange(false)
    void guardedNavigate(() => router.push(href))
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            value="AI Coach open assistant"
            onSelect={() => { onOpenChange(false); togglePanel() }}
          >
            <Sparkles />
            <span>AI Coach</span>
          </CommandItem>
          <CommandItem
            value="Add job capture URL"
            onSelect={() => { onOpenChange(false); setAddJobOpen(true) }}
          >
            <Plus />
            <span>Add job</span>
          </CommandItem>
          <CommandItem
            value="Switch theme light dark"
            onSelect={() => { onOpenChange(false); setTheme(resolvedTheme === "dark" ? "light" : "dark") }}
          >
            <SunMoon />
            <span>Switch theme</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Navigation">
          {mainNav.map((item) => (
            <CommandItem
              key={item.destination}
              value={item.label}
              onSelect={() => go(item.destination)}
            >
              <item.Icon />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Settings">
          {settingsNav.map((item) => (
            <CommandItem
              key={item.destination}
              value={item.label}
              onSelect={() => go(item.destination)}
            >
              <item.Icon />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
