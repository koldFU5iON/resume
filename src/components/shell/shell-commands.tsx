"use client"

import { useEffect } from "react"
import { usePageContext } from "@/lib/context/page-context"
import { CommandPalette } from "./command-palette"
import { AddJobDialog } from "./add-job-dialog"

/**
 * Global shortcuts and the dialogs the sidebar utilities open. Mounted once in
 * the shell (not in the sidebar, which unmounts in the closed mobile drawer),
 * so Cmd/Ctrl+K and Ctrl+L work everywhere. Ctrl+B is the sidebar's own.
 */
export function ShellCommands() {
  const { paletteOpen, setPaletteOpen, togglePanel } = usePageContext()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (key === "l") {
        event.preventDefault()
        togglePanel()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [setPaletteOpen, togglePanel])

  return (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <AddJobDialog />
    </>
  )
}
