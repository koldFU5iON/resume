'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { disconnectMcpAction } from '@/modules/mcp/connection-actions'
import type { McpConnection } from '@/modules/mcp/connections'

export function McpConnections({ endpoint, connections }: { endpoint: string; connections: McpConnection[] }) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  async function disconnect(connection: McpConnection) {
    if (!window.confirm(`Disconnect ${connection.name}? It will lose access to your account immediately.`)) return
    setDisconnecting(connection.clientId)
    try {
      await disconnectMcpAction(connection.clientId)
      toast.success('App disconnected')
    } catch {
      toast.error('Could not disconnect the app. Try again.')
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <section aria-labelledby="mcp-heading" className="space-y-5">
      <div className="space-y-1">
        <h2 id="mcp-heading" className="text-lg font-semibold">ChatGPT and Claude</h2>
        <p className="max-w-prose text-sm text-muted-foreground">Add a custom MCP connection in your AI app using the address below. Choose OAuth, then sign in here to approve access. Drafts still need your acceptance in the Writing Desk.</p>
      </div>
      <div className="max-w-2xl space-y-2">
        <Label htmlFor="mcp-endpoint">MCP server address</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="mcp-endpoint" value={endpoint} readOnly className="min-w-0 font-mono text-sm" onFocus={event => event.target.select()} />
          <Button variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(endpoint); toast.success('Address copied') }
            catch { toast.error('Select and copy the address above.') }
          }}>Copy address</Button>
        </div>
        <p className="text-xs text-muted-foreground">If asked for client registration, choose automatic registration. Your AI app must be able to reach this address.</p>
      </div>
      {connections.length === 0 ? <p className="text-sm text-muted-foreground">No AI apps connected yet.</p> : (
        <ul className="divide-y rounded-lg border">
          {connections.map(connection => <li key={connection.clientId} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-medium">{connection.name}</p>
              <p className="text-xs text-muted-foreground">{connection.scopes.includes('mcp:write') ? 'Read and edit drafts' : 'Read-only'}</p>
            </div>
            <Button variant="outline" size="sm" disabled={disconnecting !== null} onClick={() => void disconnect(connection)}>{disconnecting === connection.clientId ? 'Disconnecting…' : 'Disconnect'}</Button>
          </li>)}
        </ul>
      )}
    </section>
  )
}
