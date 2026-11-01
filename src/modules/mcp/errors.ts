// An error whose message is safe to show the MCP client. Tool handlers throw
// this for expected failures ("Job not found", validation problems). Any other
// error is treated as unexpected: logged server-side and reported to the
// client only as "Internal error", so internals never leak.
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}
