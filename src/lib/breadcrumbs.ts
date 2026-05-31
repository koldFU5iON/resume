import { mainNav } from "@/lib/nav-menu"

export type Crumb = {
  label: string
  /** Absolute href, or undefined for the current (leaf) page. */
  href?: string
}

/**
 * Static label overrides for path segments that aren't top-level nav items.
 * Seeded from `mainNav` (keyed by the segment after `/dashboard`) plus a few
 * known sub-sections. Pages can override unusual/dynamic segments per-call.
 */
const baseSegmentLabels: Record<string, string> = {
  ...Object.fromEntries(
    mainNav
      .map((item) => {
        const segment = item.destination.split("/").filter(Boolean).pop()
        return segment ? [segment, item.label] : null
      })
      .filter((entry): entry is [string, string] => entry !== null)
  ),
  settings: "Settings",
  account: "Account",
  llm: "LLM",
  "api-tokens": "API Tokens",
  experience: "Experience",
  "job-applications": "Job Applications",
  view: "Details",
}

function titleCase(segment: string): string {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Derive a breadcrumb trail from the current pathname.
 *
 * - Always starts with `Home → /dashboard`.
 * - Intermediate segments are labelled from `segmentLabels` overrides, then the
 *   static map, then a title-cased fallback.
 * - The leaf segment uses the page `title` (nicer than a slug/`[id]`) and is
 *   rendered as the current page (no link).
 */
export function deriveBreadcrumbs(
  pathname: string,
  title: string,
  segmentLabels: Record<string, string> = {}
): Crumb[] {
  const segments = pathname.split("/").filter(Boolean)

  // Everything is nested under /dashboard; drop the leading "dashboard".
  const afterDashboard = segments[0] === "dashboard" ? segments.slice(1) : segments

  const crumbs: Crumb[] = [{ label: "Home", href: "/dashboard" }]

  afterDashboard.forEach((segment, index) => {
    const isLeaf = index === afterDashboard.length - 1
    const href = `/dashboard/${afterDashboard.slice(0, index + 1).join("/")}`

    if (isLeaf) {
      crumbs.push({ label: title })
      return
    }

    const label =
      segmentLabels[segment] ?? baseSegmentLabels[segment] ?? titleCase(segment)
    crumbs.push({ label, href })
  })

  return crumbs
}
