# Connect ChatGPT and Claude to currnt

The remote MCP server is at `https://<your-currnt-host>/api/mcp`. Copy the exact
address from **Settings → API tokens → ChatGPT and Claude**.

## Before connecting

Deploy this change, including its migration. Set `BETTER_AUTH_URL` to the
canonical HTTPS origin of that deployment, without `/api/mcp`. Keep
`BETTER_AUTH_SECRET` stable: it protects account sessions, signed authorization
requests, and encrypted signing keys. No OpenAI or Anthropic API key or
separate OAuth application secret is needed for automatic client registration.

The client must be able to reach the server. A localhost address works for
local CLI clients, but ChatGPT and Claude's remote connectors need a publicly
reachable HTTPS URL. Deployment protection must permit the connector's
requests. Use the same host throughout authorization and MCP requests; tokens
are bound to the exact resource URL.

## ChatGPT

1. Open ChatGPT's custom MCP/app setup (developer access or workspace admin
   permission may be needed). Follow the current
   [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
2. Enter your currnt `/api/mcp` address and choose **OAuth**.
3. Use **Dynamic Client Registration / automatic registration** if prompted.
   This implementation supports DCR, not Client ID Metadata Documents (CIMD).
   Leave client ID/secret blank when automatic registration is selected.
4. Sign in with your existing currnt account. On the currnt consent screen,
   review the return host, signed-in account, and requested access. App names
   are supplied by the connecting app and are not verified identities.
5. **Create and edit CV drafts** is checked by default when requested. Uncheck
   it for read-only access, or choose **Deny** to cancel.
6. Enable the connection in a chat and ask: “List my active job applications.”

Your MCP server remains private; this does not publish an app to a directory.

## Claude web / Desktop

1. Open **Customize → Connectors → Add → Add custom connector** (organization
   owners may need to add it first on Team/Enterprise).
2. Enter the currnt MCP address. Choose sign-in via OAuth and
   **Register automatically** for the OAuth client. Do not choose Claude's
   published identity / CIMD with this provider version.
3. Sign in to currnt and approve the requested access.
4. Enable the connector in your chat and ask it to list your jobs.

See [Claude's custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
for the current account-specific UI.

## Claude Code and static-header clients

OAuth-enabled clients can discover authorization from the server's 401
challenge. Alternatively, create an API token in currnt Settings:

- **Capture jobs only** cannot access MCP.
- **MCP read-only** exposes only the four read tools.
- **MCP read and edit drafts** exposes all eight tools.

Choose an expiry (30, 90, or 365 days, or never), copy the token once, and
configure it as a bearer header. For Claude Code:

```sh
claude mcp add --transport http currnt https://<your-currnt-host>/api/mcp \
  --header "Authorization: Bearer <your-rsm-token>"
```

ChatGPT's hosted connector uses OAuth rather than these static tokens.

## Tools and review

| Tool | Scope | Purpose |
| --- | --- | --- |
| `list_jobs` | `mcp:read` | List job applications; active jobs by default |
| `get_job_context` | `mcp:read` | Job, its Writing Desk documents, profile, master CV, supported blocks, and writing guidance |
| `profile_map` | `mcp:read` | Index of the whole profile (one line per note), completeness and gaps |
| `profile_get_note` | `mcp:read` | One profile note in full, with links to follow |
| `profile_list` | `mcp:read` | Every note of one type, e.g. certifications or tools |
| `profile_backlinks` | `mcp:read` | What points at a note, e.g. the evidence behind a skill |
| `profile_search` | `mcp:read` | Keyword search across the profile, with snippets |
| `profile_gaps` | `mcp:read` | Missing or weak areas, phrased as questions |
| `get_draft` | `mcp:read` | Read sections, hashes, and diagnostics |
| `validate_draft` | `mcp:read` | Validate the draft and return advisory fact warnings |
| `create_draft` | `mcp:write` | Create a CV draft in one of a job's Writing Desk documents |
| `replace_section` | `mcp:write` | Replace a section using its current hash |
| `insert_section` | `mcp:write` | Insert a draft section |
| `remove_section` | `mcp:write` | Remove a section using its current hash |

The read scope also exposes `currnt://writing-contract/cv` as a resource.
Scope filtering hides unavailable tools and rejects guessed tool names.
Every call uses the authenticated account's profile.

No tool returns your contact details (email, phone, LinkedIn, GitHub, website).
Agents write `{{contact}}` in the CV header instead, and the app replaces it
with your contact line when you accept the draft.

### Which document a draft goes to

A job can hold several named Writing Desk documents (for example two CVs and a
note). Each has its own content, revisions and draft. `get_job_context` lists
them (`documents`: id, name, type, whether a draft is pending; primary/oldest
first), and every draft tool (`get_draft`, `validate_draft`, `create_draft`,
`replace_section`, `insert_section`, `remove_section`) takes an optional
`documentId`. Draft results return the `documentId` and `documentName` they
used. Agents never land on an arbitrarily chosen document:

- **With `documentId`:** the call uses exactly that document. It must belong to
  your account and to the given job; otherwise it fails with "No Writing Desk
  document with that id belongs to this job" and nothing is read or written.
- **Without `documentId`, one document:** the call uses it when it's a CV, or
  has no type and still has a default name ("CV" or "Untitled document"), as
  before documents had names. Any other single document (say "Interview
  notes") is refused with nothing written; pass its `documentId` only if the
  user wants a CV draft there.
- **Without `documentId`, no document:** reads report that there is no draft;
  `create_draft` creates the job's first document, named "CV".
- **Without `documentId`, several documents:** the call is refused and nothing
  is written. The error lists each document's id, name and type so the agent
  can retry with `documentId`.

Agent drafts are CVs only: a document with another type refuses
`create_draft`.

Ask the client to read job context first, draft a CV, and revise its sections.
Then open that document in the job's **Writing Desk** to compare the draft with
the live document. You can edit it manually and **Accept** or **Discard** it. MCP cannot
accept drafts, change job status, edit your profile, or access other accounts.
Fact checks are advisory; review claims yourself before accepting.

## Disconnect and token lifetime

In currnt **Settings → API tokens**, choose **Disconnect** beside a connected
app. This removes your consent and refresh tokens; MCP checks consent on every
request, so existing access tokens stop working immediately. Tokens are bound
to that consent record; reconnecting does not restore old tokens. Other users of
the same client remain connected. Disconnect it in the AI app too if you want
to remove its entry there.

OAuth access tokens last one hour. `offline_access` permits rotating refresh
tokens lasting up to 30 days. API tokens have independently chosen expiry and
revocation. OAuth changes appear in draft history under the OAuth client actor;
they never add provenance text to a CV or PDF.

## Protocol details

- Stateless Streamable HTTP with JSON responses; POST only. GET and DELETE
  return 405 because there is no standalone SSE stream or persistent session.
- Initial 401 challenges omit a scope hint so clients discover all supported
  scopes, including `offline_access` for refresh tokens. Insufficient-scope
  responses still advertise the required MCP scopes.
- Resource metadata: `/.well-known/oauth-protected-resource/api/mcp`.
- Authorization-server discovery: `/.well-known/oauth-authorization-server/api/auth`.
- Authorization, registration, token, and revocation endpoints are advertised
  by discovery under `/api/auth/oauth2/`. S256 PKCE is required.
- JWT access tokens are verified against local Better Auth public keys, the
  issuer, exact `/api/mcp` audience, expiry, client state, and current consent.
  Tokens without the MCP audience are refused. Clients must send `resource`
  at code exchange and refresh. Provider 1.6 omits it from the consent query;
  the issuer permits only this one resource at token exchange.
- Signing keys are cached for a minute. Unknown key IDs can trigger a shared
  refresh at most once every five seconds per server instance.
- Public registration is limited to five requests per IP per minute, with
  an atomic database check before client creation, shared across server instances.
  The deployment proxy must supply a trusted `X-Forwarded-For` client IP;
  registration fails closed if the IP or database is unavailable.
- Discovery GET and OPTIONS responses permit cross-origin metadata requests.
- No application LLM calls are made by MCP; generation runs in your AI client.

## Local verification

```sh
npm run db:migrate
npm run test:mcp-oauth
npm test
npm run typecheck
npm run lint
npm run build
```

`test:mcp-oauth` refuses a remote database. It uses disposable local accounts
and clients and cleans them up afterward. It uses the MCP SDK for discovery,
registration, token exchange, and refresh rotation. It also checks login
continuation, signed/denied consent, PKCE, code replay, scope filtering,
ownership, draft editing and acceptance, unique consent, sequential/concurrent
registration limits and window reset, and per-user disconnect/reconnect.

These local checks do not establish a successful hosted ChatGPT or Claude
connection. After deployment, test each client through list jobs → draft →
revise → review and accept, then disconnect and confirm access is refused.
