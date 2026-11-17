# Landing page: positioning, structure and rebuild plan

Working proposal for [issue #403](https://github.com/koldFU5iON/resume/issues/403). `mockup.html` is a static concept of the full page. It is self-contained (inline CSS, Geist from Google Fonts), uses the Slate tokens from `src/app/globals.css`, follows `prefers-color-scheme`, and works down to 390 px. Every product visual is rebuilt from the real components named below. Job, company, CV, scores and costs are **illustrative sample content** (the fictional "Northstar" and "Alex Morgan" from the job-workspace mockup). No app code was changed.

Screenshots: `desktop.png`, `desktop-dark.png` (1440, full page), `phone.png`, `phone-dark.png` (390 @2x, full page). Alternative hero: `mockup-alt-hero.html`, `mockup-alt-hero.png` (dark, desktop, first screen) and `mockup-alt-hero-phone.png`.

## Recommendation in one paragraph

Lead with **experienced job seekers who already use ChatGPT or Claude**, and promise them one thing: *know which jobs are worth it, then write the CV that proves it*. Show the real job workspace in the hero. A four-step "how it works" (Capture → Assess → Research → Write) comes next. Then four feature rows built on current product: Decide (early assessment + deep dive), Write (Writing Desk), Record (profile), Find (job hunt). Agent and MCP users get their own full-width section. It is the strongest differentiator, but it comes second, not first. Move self-hosting and `git clone` into a dedicated open-source section near the bottom. Replace the "No job board" pill with true facts, and answer "is this a job board?" in the FAQ. Leave the deprecated tools out entirely.

---

## 1. Positioning and audience

| | Job seekers using AI (recommended primary) | Technical / agent users (secondary) |
|---|---|---|
| Who | Experienced professionals with messy, non-linear careers (PRODUCT.md "eventual" user). Already paste job ads into ChatGPT. | Developers and AI power users running Claude Code, Hermes, or MCP connectors |
| Pain | Too many roles and too little time. Every application starts from a blank CV. AI output they can't trust. | Their agent has no structured career data and no safe place to write |
| What wins them | Early triage, a sourced verdict, tailored drafts they control | MCP server, scoped tokens, capture API, skills, MIT licence, self-host |
| Size | Large | Small, but likely to advocate and contribute |

**Why job seekers first:** the product's core loop (assess → research → write) is for them. The agent features also serve them ("use the AI app you already pay for"). An agent-first hero would lose the people who don't know what MCP is, and the technical users still find their section from the nav. `mockup-alt-hero.html` shows the agent-first alternative for comparison. Use it only if early users turn out to be mostly technical.

**Brand voice** (from `PRODUCT.md` and `/about`): calm, intelligent, precise; never breathless about AI; "shows the seams on purpose". The copy avoids hype words. Every claim is something the code does today. No testimonials, user counts, logos or invented metrics.

## 2. Messaging hierarchy

1. **Promise:** Know which jobs are worth it. Then write the CV that proves it.
2. **How:** a structured career record → every job assessed against it → the serious ones researched → each application written in its own workspace.
3. **Trust:** you see the reasoning (blockers, sources, costs); you approve every edit (drafts, never overwrites); research never sees your profile; findings without a source are dropped.
4. **Ownership:** open source (MIT), your own AI key, connects to the AI tools you already use, self-hostable.
5. **Breadth (supporting):** job hunt watchlist, Scout links, UK sponsor register, Coach, usage page.

## 3. Page structure and draft copy

The final copy is in `mockup.html`. Summary:

| # | Section | Headline / key copy | Visual (real UI it recreates) |
|---|---|---|---|
| 0 | **Nav** (sticky) | Logo · How it works · Features · For AI agents · Cost · FAQ · Open source (GitHub) · Sign in · **Get started** | `public-nav.tsx`, expanded with section anchors |
| 1 | **Hero** | Eyebrow "Stay current." H1 "Know which jobs are worth it. *Then write the CV that proves it.*" Lede: "currnt keeps a structured record of your career, checks every job you save against it, researches the ones you're serious about, and gives each application its own writing desk. You see the reasoning. You approve every edit." CTAs: **Get started**, See how it works; "Have an account? Sign in". Facts: Open source, MIT licence · AI runs on your own Anthropic, OpenAI or Google key · Connects to ChatGPT and Claude | Full job workspace: app sidebar (`nav-menu.ts` labels, legacy tools removed), `job-workspace-header.tsx` (status, early-assessment score + deep-dive `VerdictChip`, red Archive), `job-document-nav.tsx` tabs + "+", Writing Desk toolbar (CV prompt, Write/Split/Preview, Export), the draft review strip ("Agent created the draft." / "Accepting replaces the live document with this draft."), Markdown + preview |
| 2 | **How it works** | "From job ad to finished application, in one place." 01 Capture, 02 Assess, 03 Research, 04 Write, each with one sentence and one small UI element | Add-job URL input; score pill "7/10 · Pursue"; verdict chip; document tabs |
| 3 | **Decide** | "A first read in seconds. A full report when it matters." Bullets: early assessment levels (Weak/Consider/Pursue/Priority) and blockers; deep dive with 3 researchers who never see the profile; "no invented facts" source rule; UK sponsor register | `early-assessment.tsx` detail (ScoreHeader + gauge, Strengths / Gaps / Check these, footer line) and `deep-dive/_components/report.tsx` (verdict, "Worth a tailored CV", "Chance of an interview", Pay "Suggested ask" Floor/Target/Stretch, Practicalities, numbered Sources) |
| 4 | **Write** | "One job, as many documents as it needs." Markdown + preview + export; CV prompt for your own AI app; drafts, not overwrites | Document tabs + split editor, with the `external-cv-prompt.tsx` sheet ("Draft a CV in your own AI app", "Copy CV prompt") |
| 5 | **Record** | "Your whole career, written down once." Notes not form fields; evidence linked to skills; import your current CV | Profile workspace: `NotesNav`, `ExperienceNote`/`NoteEditor`, `EvidencePanel` + skills |
| 6 | **Find** | "Watch the companies you care about." "currnt isn't a job board. It checks the places you choose…" Watchlist (Greenhouse, Lever, Ashby, SmartRecruiters); boards (Remotive, Remote OK; Adzuna, JSearch with keys); Scout links | `job-hunt/page.tsx` criteria bar, `scan-status-bar.tsx`, `job-queue-row.tsx` (fit badge, New, salary, age, source, Import/Ignore/Score Fit), watchlist |
| 7 | **Also** | Career Coach · Search context · Usage you can see · A pipeline that keeps up | Text only, hairline-separated (no icon grid) |
| 8 | **For AI agents** (navy band, both themes) | "Your career record, available to the AI tools you already use." Routes: ChatGPT and Claude (connector, OAuth, read-only or drafts) · Claude Code (`claude mcp add`, `capture-job` skill, Hermes) · Anywhere else (capture API, bookmarklet). Note: agents never see contact details and can't accept their own drafts | Terminal with the real `claude mcp add` command from `docs/mcp-server.md`, plus six real tool names with scopes |
| 9 | **Cost** | "Free to run yourself. A small fee if we host it." Cards: **Self-hosted: Free** (MIT, own Postgres) · **Hosted account: $7 / month** (hosting, storage, backups, email, early assessment). **Free during early development:** the price is shown blurred with a "Free during early development" badge · AI features **Your provider's rates** | Plain cards |
| 10 | **Open source** | "Read the code. Or run it yourself." MIT; prompts and checks are in the repo; self-host keeps the record in your own database. `git clone` + setup commands from README; stack chips | `CloneSnippet.tsx`, moved here |
| 11 | **FAQ** | Do I need an AI key to start? · Will an AI send applications for me? · Is currnt a job board? · What do the AI researchers see? · Sponsorship outside the UK? · Can I move my data out? | Native `<details>` |
| 12 | **Final CTA** | "Start with one job." "Save a role you're weighing up and see what currnt makes of it." Get started · Run it yourself | |
| 13 | **Footer** | "Built to help people find work. MIT licensed." About · Support · GitHub · Sign in · Get started | |

Signed-in visitors: replace every "Get started / Sign in" pair with **Go to dashboard →** (as today). Hide the final CTA band, or change it to "Open your dashboard".

### Feature-claim sources (keep these true when copy changes)

- Early assessment levels, blockers/strengths/gaps/"Check these": `early-assessment-view.ts`, `early-assessment.tsx`, `docs/job-assessment.md`.
- Deep dive researchers never see profile; source rule; register; per-run cost: `docs/deep-dive.md`, `deep-dive-view.ts` (`formatRunCost`).
- Multiple documents, CV prompt, draft accept/discard wording: `job-workspace/*`, `writing/_components/writing-desk.tsx`, `external-cv-prompt.tsx`.
- MCP tools, scopes, "no contact details", no draft acceptance via MCP: `docs/mcp-server.md`, AGENTS.md.
- Job hunt ATS providers and boards: `src/modules/job-hunt/*`, `job-hunt/page.tsx`. Scout: `src/modules/scout-inbox/`, `src/app/scout/`.
- Sponsor register: exact-name match, UK only, absence not proven: `sponsor-chip.tsx`, `docs/companies.md`.

## 4. CTA strategy

- **One primary action everywhere:** "Get started" (nav, hero, final band). The secondary hero button is "See how it works", an in-page anchor, never a second conversion path.
- **Self-host moves down** to its own section (10), linked from the nav's "Open source" item and the final band's ghost button "Run it yourself". It stops competing with sign-up in the first screen. Technical visitors still reach it in one click.
- **Sign in** stays in the nav and as a quiet line under the hero CTAs.
- Agents section: no CTA button. Its job is to inform. A later PR could add "Connect an agent" linking to the public docs once `docs/mcp-server.md` has a public URL.

## 5. The "No job board" pill

Remove it. It now contradicts Job hunt / Scout. What it meant ("we don't sell your attention to employers") is still true, so it moves to the FAQ: *"Is currnt a job board? No. There are no listings to browse and no employers paying for placement. Job hunt only checks the companies and boards you choose."* The Find section opens with the same idea. The hero facts become: Open source, MIT licence · AI runs on your own key · Connects to ChatGPT and Claude.

## 6. SEO, meta, OG

- **Title:** `currnt: know which jobs are worth it` (root `metadata.title.default` stays `currnt`; set an explicit title on `/`).
- **Description** (`brand.metaDescription`, ≤160 chars): "currnt checks every job against your career record, researches the ones worth it, and helps you write a CV for each. Open source, your own AI key."
- **OG/Twitter image:** add `src/app/opengraph-image.tsx` (and `twitter-image`) via `next/og`, 1200×630, dark Slate background, logo, the H1, and a cropped workspace header (title + score + verdict chip). Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md` first (Next 16).
- **`metadataBase`** from `BETTER_AUTH_URL` in the root layout so OG URLs resolve.
- **`robots.ts` and `sitemap.ts`** (none exist): allow `/`, `/about`, `/support`, `/sign-up`; disallow `/dashboard`, `/api`, `/scout`.
- **Structured data:** one JSON-LD `SoftwareApplication` (name, applicationCategory "BusinessApplication", operatingSystem "Web", `offers.price: 0`, `license` MIT, `codeRepository`). No `aggregateRating`, because we have none.
- Keep one `<h1>`. Section `<h2>`s carry the keywords naturally (job assessment, CV, MCP).

## 7. Responsive behaviour

- Breakpoints mirror the mockup: ≤1100 px drops the app sidebar from the hero frame and stacks feature rows (text first); ≤900 px hides nav section links, makes the steps 2×2 and the profile visual two-column; ≤640 px uses 16 px gutters, full-width hero buttons, a single column throughout.
- **Phone hero frame** keeps the parts that tell the story: job header (status, score, verdict, Archive icon), tabs, doc toolbar, draft strip and the **preview only** (the Markdown pane hides). This matches the real compact header (#365 Phase 1). There is no horizontal page scroll; this was checked at 390 px (`scrollWidth` = 390).
- Visuals never scale with `transform: scale()`. They reflow, so text stays legible and selectable.
- Phone length is about 13,400 px. If that feels long, trim on phone first: hide the "Also" grid and collapse the Find visual to two rows.

## 8. Accessibility

- Each product visual is decorative (`aria-hidden`), except the hero frame, which is `role="img"` with a full text description. The adjacent copy already states every claim.
- Contrast: Slate tokens; tinted status colours use the 600/700 (light) / 400 (dark) convention from DESIGN.md, and colour is never the only signal (labels "Pursue", "Apply, with caveats" always shown).
- Landmarks: `header`/`nav` (labelled), `main`, `footer` nav (labelled); one `h1`, sections `aria-labelledby` their `h2`.
- Visible focus ring (`--ring`), `scroll-margin-top` for anchors under the sticky nav, `prefers-reduced-motion` disables smooth scroll. FAQ uses native `<details>` (keyboard and screen-reader support built in).
- In production, use real `<a>`/`<Link>` for every CTA. In the decorative visuals, avoid focusable look-alike buttons; use spans, as the mockup does.
- Lighthouse/axe pass is part of the final PR.

## 9. Implementation breakdown (small PRs)

Read the relevant Next 16 guide in `node_modules/next/dist/docs/` before each PR. Cut each branch from `origin/main`.

1. **Copy model + hero (no new visuals yet).**
   - Restructure `src/lib/brand.ts`: keep identity fields and `about` untouched. Replace `hero` and `features` with a typed `landing` object (`hero`, `facts`, `steps`, `features[] {id, eyebrow, title, intro, points[]}`, `also[]`, `agents`, `cost[]`, `openSource`, `faq[]`, `finalCta`) and update `metaDescription`.
   - New `src/app/_components/landing/` (`hero.tsx`, `steps.tsx`, `feature-row.tsx`, `faq.tsx`, `final-cta.tsx`).
   - `page.tsx` becomes composition only. Delete `feature-section.tsx` and `feature-fragments.tsx` once unused. Move `CloneSnippet` into the open-source section.
   - `public-nav.tsx` gets the section anchors (desktop only) and keeps auth-aware buttons.
   - Remove the "No job board" pill. This PR alone fixes the contradiction and the CTA competition.
2. **Product showcase components.** Add `src/app/_components/landing/showcase/`: `workspace-frame.tsx`, `assessment-card.tsx`, `deep-dive-card.tsx`, `writing-desk-card.tsx`, `profile-card.tsx`, `job-hunt-card.tsx`. These are static server components with fixed sample data, styled with the theme tokens. **Import label and colour constants from the real view helpers** (`EARLY_LEVEL_LABEL`, `EARLY_TEXT_STYLES`, `VERDICT_LABEL`, `VERDICT_TEXT/CHIP`, `LIKELIHOOD_LABEL`, `DEEP_DIVE_STAGES`) and reuse pure leaf components (`ScorePill`, `ScoreGauge`, `ScoreHeader`, `Badge`, `buttonVariants`), so wording and colours can't drift. Don't render client components with server actions (`EarlyAssessment`, `StatusDropdown`, `SponsorChip` popover) on the public page.
3. **Agents, cost, open source, FAQ sections.** Pull the MCP command and tool names from a small constant shared with the settings page if one exists; otherwise add one in `src/modules/mcp/`.
4. **Metadata.** `opengraph-image.tsx`, `twitter-image.tsx`, `robots.ts`, `sitemap.ts`, `metadataBase`, JSON-LD on `/`.
5. **Polish and verify.** Responsive check at 1440/1280/768/390 in both themes; axe + Lighthouse; signed-in variant; reduced motion; check every link. Update `DESIGN.md` (it still documents the old cyan palette, not Slate) and the about page's CTA to match.

Size: PR 1 ≈ brand.ts + 6 small files; PR 2 is the largest (≈6 presentational files, no data access); the rest are small. No schema changes, no migrations, no new dependencies.

**Real screenshots vs HTML recreations.** Use HTML showcase components rather than PNG screenshots. They theme with the page in light and dark, stay sharp at any density, and are readable and translatable. They also can't leak real user data, and constants imported from the real helpers keep labels honest. Screenshots would need four variants per image and go stale with every UI change. The one exception is the OG image, which is generated anyway.

## 10. Other notes found while checking

- **Theme default:** the root layout forces `defaultTheme="dark"`. The mockup follows the OS. Decide whether `/` should follow the system or stay dark-first (see open questions). Both are designed.
- **Two fit scales in the product:** discovered jobs (`job-queue-row.tsx`) show the legacy *standout/solid/stretch/possible/reach* labels, while the workspace uses the early assessment's *Weak/Consider/Pursue/Priority*. The landing page shows each where it really appears. Unifying them would make the story cleaner (out of scope here).
- **Early assessment is gated:** `JOB_ASSESSMENT_V2` defaults to `admin`. If production isn't `all`, the page must not promise "every saved job gets an early assessment".
- **Deprecated tools** (CV Builder, Cover Letters, Interview Prep) are omitted from the copy and from the recreated sidebar.
- `brand.githubUrl` points to `koldFU5iON/currnt` while the issue lives in `koldFU5iON/resume`. Check the canonical repo before shipping the clone snippet.

## 11. Open questions for the owner

1. **Audience:** do you agree that job seekers come first, with agents as a dedicated section? Or do you prefer the agent-first hero (`mockup-alt-hero.html`)?
2. **Early assessment availability:** is `JOB_ASSESSMENT_V2=all` in production, or about to be? If not, soften Step 02 and the Decide row to "on demand". Separately, do you want to advertise that Jev is app-paid ("Mostly on us"), and is the daily cap a number you're happy to publish?
3. **Pricing (decided direction):** open source and free to self-host; hosted accounts pay a fee for hosting and storage. Plans are $7 / 30 days, $19 / 90 days and $75 a year (Stripe checkout: #409). Sign-up is free during early development.
4. **Scout and job hunt:** advertise them now (as proposed), or hold back until they leave early access? If held back, drop the Find row and the Capture step's Scout mention, and keep the FAQ answer.
5. **Theme on `/`:** follow the system preference, or keep dark-first like the app?
6. **Hosted data and privacy:** is there a privacy page to link from the FAQ and footer? It matters for "what happens to my data", and the FAQ doesn't make claims about training or retention until one exists.
7. **Canonical repo/URL** for the clone snippet and JSON-LD (`currnt` vs `resume`), and the production domain for `metadataBase`.
8. **Coach and sponsor matching emphasis:** the sponsor register is UK-only. Keep it as a Decide bullet (proposed), or move it to the "Also" list for a non-UK audience?
