"use client"

import { useState } from "react"

import { CommandBar } from "./command-bar"
import { AppFooter } from "./app-footer"
import { ChatPanel } from "./chat-panel"

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* Center column: command bar / main content / footer */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CommandBar
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((open) => !open)}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
        <AppFooter />
      </div>

      {/* Full-height right panel reserved for the assistant */}
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
