"use client"

import React from "react"
import { MobileTopBar } from "./mobile-top-bar"
import { ShellCommands } from "./shell-commands"
import { COACH_PANEL_CLASSES } from "./coach-panel"
import { AppFooter } from "./app-footer"
import { AlphaBanner } from "./alpha-banner"
import { ChatPanel } from "./chat-panel"
import { usePageContext } from "@/lib/context/page-context"

type ErrorBoundaryState = { error: boolean }

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: false }
  }

  static getDerivedStateFromError() {
    return { error: true }
  }

  render() {
    if (this.state.error) {
      return (
        <aside className={COACH_PANEL_CLASSES}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">The assistant encountered an error.</p>
            <button
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
              onClick={() => this.setState({ error: false })}
            >
              Try again
            </button>
          </div>
        </aside>
      )
    }
    return this.props.children
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { chatOpen, closePanel } = usePageContext()

  return (
    // group/shell: the job workspace (data-job-workspace) brings its own
    // navigation trigger, so the phone top bar hides while one is on screen.
    <div className="group/shell flex h-svh w-full overflow-hidden print:h-auto print:overflow-visible print:block">
      {/* Center column: phone bar / main content / footer */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="contents group-has-[[data-job-workspace]]/shell:hidden">
          <MobileTopBar />
        </div>
        <AlphaBanner />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto print:overflow-visible print:h-auto">{children}</div>
        <AppFooter />
      </div>

      {/* Full-height right panel reserved for the assistant */}
      <ChatErrorBoundary>
        <ChatPanel open={chatOpen} onClose={closePanel} />
      </ChatErrorBoundary>
      <ShellCommands />
    </div>
  )
}
