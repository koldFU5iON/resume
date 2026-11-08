# API integration recipes

Copy-pasteable recipes for calling `POST /api/jobs/capture` from common surfaces. The technical contract lives in [`docs/api-jobs-capture.md`](./api-jobs-capture.md); this file is the "how do I wire this into my tool" layer.

> Throughout this doc, `<YOUR_RESUME_URL>` stands in for your deploy's hostname (e.g. `https://resume.example.com`). Anywhere it appears in a snippet, substitute it before running.

> **Security**: tokens look like `rsm_<43 chars>` and are shown **once** at creation. Store them in a secrets manager, env var, or password manager. **If a token leaks, revoke it immediately** at `<YOUR_RESUME_URL>/dashboard/settings/api-tokens` and mint a new one.

## Get a token

1. Sign in at `<YOUR_RESUME_URL>/dashboard`
2. Open `<YOUR_RESUME_URL>/dashboard/settings/api-tokens`
3. Mint a token — save the value somewhere safe (it won't be shown again)
4. Export it for shell use:

```bash
export RSM_TOKEN="rsm_..."
# Add to ~/.zshrc or ~/.bashrc to persist across sessions.
```

---

## Shell / curl

The fastest path. Drop this function into `~/.zshrc` or `~/.bashrc`:

```bash
# Usage:
#   rsm-capture <url> [notes]
#   rsm-capture https://boards.greenhouse.io/stripe/jobs/5530229
#   rsm-capture https://… "referred by Alex"
rsm-capture() {
  local url="${1:?usage: rsm-capture <url> [notes]}"
  local notes="${2:-}"
  local body
  if [[ -n "$notes" ]]; then
    body=$(jq -nc --arg u "$url" --arg n "$notes" '{url:$u, notes:$n}')
  else
    body=$(jq -nc --arg u "$url" '{url:$u}')
  fi
  curl -sS -X POST <YOUR_RESUME_URL>/api/jobs/capture \
    -H "Authorization: Bearer ${RSM_TOKEN:?set RSM_TOKEN env var first}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    | jq '{title, company, created, reviewUrl, duplicate}'
}
```

After capture, open the result in your browser:

```bash
rsm-capture "https://..." | jq -r .reviewUrl | xargs xdg-open  # Linux
rsm-capture "https://..." | jq -r .reviewUrl | xargs open      # macOS
```

---

## Claude Code skill

Install once; then any Claude Code session can capture jobs by saying "save this job" with a URL.

### Install

The dashboard's `/settings/api-tokens` page has a one-click **Download SKILL.md** button under "Agent integrations" — it serves a copy of the skill with your deploy URL already filled in. Drop it at the install path:

```bash
mkdir -p ~/.claude/skills/capture-job
curl -sSL <YOUR_RESUME_URL>/api/integrations/skills/claude-code \
  -o ~/.claude/skills/capture-job/SKILL.md
```

Make sure `$RSM_TOKEN` is exported in your shell config so Claude Code sessions inherit it.

### Use

In any Claude Code session:

> User: "save this job https://www.mongodb.com/careers/jobs/7465124"

Claude will recognize the trigger phrase + URL, invoke the skill, and POST to the endpoint with `$RSM_TOKEN`. It then reports back the extracted title, company, and `reviewUrl`.

The canonical skill source lives at [`src/lib/integrations/skills/claude-code.md`](../src/lib/integrations/skills/claude-code.md) (with a `{{RESUME_URL}}` placeholder that the download endpoint substitutes at request time).

---

## Hermes agent skill

[Hermes](https://hermes-agent.nousresearch.com) (Nous Research's agent) has its own skills format with **interactive config prompts** — the user doesn't manage env vars; Hermes asks for the bearer token on first invocation and stores it persistently.

### Install

```bash
mkdir -p ~/.hermes/skills/job-search/capture-job
curl -sSL <YOUR_RESUME_URL>/api/integrations/skills/hermes \
  -o ~/.hermes/skills/job-search/capture-job/SKILL.md
```

### Use

In any Hermes session, ask:

> "save this job https://www.mongodb.com/careers/jobs/7465124"

On first invocation, Hermes prompts:

> Paste your Resume bearer token (starts with rsm_). Mint one at the URL below if you don't have one yet:
> &lt;YOUR_RESUME_URL&gt;/dashboard/settings/api-tokens

Token is stored in `config.yaml` under `skills.config.resume.bearer_token` — no env var management needed.

You can also invoke explicitly with `/capture-job <url>`.

The canonical skill source lives at [`src/lib/integrations/skills/hermes.md`](../src/lib/integrations/skills/hermes.md).

### Format note

Hermes skills are structured into four named sections (When to Use / Procedure / Pitfalls / Verification) — different from Claude Code's free-form markdown. Same content underneath; just a different wrapper.

---

## Browser bookmarklet

Capture the current tab with a single click. The token is embedded in the bookmarklet URL — **anyone with access to your browser can see it**, so use this only on a trusted machine, and revoke + remint if the device is ever shared.

### Install

1. Copy the snippet below
2. Replace `rsm_PASTE_TOKEN_HERE` with your actual token and `<YOUR_RESUME_URL>` with your deploy hostname
3. Right-click the bookmarks bar → Add page → set URL to the snippet, name it "Capture job"

```js
javascript:(()=>{const t='rsm_PASTE_TOKEN_HERE';fetch('<YOUR_RESUME_URL>/api/jobs/capture',{method:'POST',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({url:location.href})}).then(r=>r.json()).then(d=>{if(d.reviewUrl){window.open(d.reviewUrl,'_blank')}else{alert('Capture failed: '+JSON.stringify(d))}}).catch(e=>alert('Network error: '+e.message))})();
```

### Use

Open any job posting → click the bookmarklet → a new tab opens to the dashboard view of the captured job. If extraction fails (422 from a site we don't yet handle), an `alert()` shows the error body.

---

## Coming soon (follow-up issue)

For ChatGPT, Claude, and other MCP clients, see [MCP setup](mcp-server.md).

These surfaces are TODO — file an issue if you need one and we'll prioritize:

- **Anthropic Claude API tool definition** — JSON tool schema + Python/TS example loop wiring it into `client.messages.create(...)`
- **OpenAI function calling** — function definition + chat completions loop

The contract is stable, so building any of these against the existing spec is straightforward.

---

## Adding a new agent

The download endpoint (`GET /api/integrations/skills/<agent>`) is whitelist-driven. To add a new agent:

1. Drop a templated SKILL.md at `src/lib/integrations/skills/<agent>.md`, using `{{RESUME_URL}}` wherever the deploy URL should be filled in
2. Add `<agent>` to the `SUPPORTED_AGENTS` whitelist in `src/app/api/integrations/skills/[agent]/route.ts`
3. Add a card to the dashboard integrations grid in `src/app/dashboard/settings/api-tokens/_components/integrations-list.tsx`
4. Add a recipe section to this doc

Steps 1-3 must all land together — adding the file alone won't expose it; adding the whitelist entry without the file returns a 500.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | `RSM_TOKEN` unset, malformed, or revoked | Mint a new token, re-export `RSM_TOKEN`. |
| `400 Bad Request` | Invalid URL or malformed JSON body | Check the URL; ensure body matches the schema in `docs/api-jobs-capture.md`. |
| `422 Unprocessable Entity` | Extractor couldn't get title/company from this site | File an issue with the URL — `src/modules/jobs/extract.ts` is where new site templates land. |
| Bookmarklet does nothing | Browser stripping the `javascript:` prefix when pasting | Re-paste the snippet directly into the bookmark URL field, not the page content. |
| Skill never triggers in Claude Code | Skill file in wrong location, or trigger phrase didn't match | Verify `~/.claude/skills/capture-job/SKILL.md` exists; try a more explicit phrase like "use the capture-job skill on this URL". |
| Downloaded SKILL.md still has `{{RESUME_URL}}` | You hit the file in the repo, not the download endpoint | Use `<YOUR_RESUME_URL>/api/integrations/skills/<agent>` — that's where substitution happens. |
