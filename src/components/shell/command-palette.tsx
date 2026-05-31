"use client"

import { useRouter } from "next/navigation"
import { Settings, KeyRound, Sparkles, UserCog } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { mainNav } from "@/lib/nav-menu"

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

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
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
