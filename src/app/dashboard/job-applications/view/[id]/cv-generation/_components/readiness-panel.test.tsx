import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ReadinessPanel, readinessHeading } from "./readiness-panel"
import { checkProfileReadiness } from "@/modules/profile-readiness"
import { NOW, cleanProfile, messyImport } from "@/modules/profile-readiness/__fixtures__/profiles"

describe("ReadinessPanel", () => {
  it("shows the count, a collapsed preview and an edit link per finding", () => {
    const report = checkProfileReadiness(messyImport(), NOW)
    const html = renderToStaticMarkup(<ReadinessPanel report={report} />)
    expect(html).toContain(readinessHeading(report))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('id="profile-readiness"')
    expect(html).toContain('href="/dashboard/profile/n/pr1"')
    expect(html).toMatch(/Project &quot;Enemies Demo Campaign&quot; has only its title/)
  })
  it("says the profile is ready when there is nothing to report, and never uses contact details", () => {
    const report = checkProfileReadiness(cleanProfile(), NOW)
    const html = renderToStaticMarkup(<ReadinessPanel report={report} />)
    expect(html).toContain("Profile ready")
    expect(html).not.toContain("robin@example.test")
  })
  it("words the heading from the fix and consider counts", () => {
    expect(readinessHeading({ total: 5, fixCount: 2 })).toBe("Profile readiness: 2 to fix, 3 to consider")
    expect(readinessHeading({ total: 2, fixCount: 0 })).toBe("Profile readiness: nothing to fix, 2 to consider")
  })
})
