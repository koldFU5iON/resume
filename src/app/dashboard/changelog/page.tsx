import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ReactMarkdown from 'react-markdown'
import { ContentContainer } from '@/app/components/ContentContainer'
import { APP_VERSION } from '@/lib/version'

// CHANGELOG.md is written by scripts/release.mjs (see docs/releases.md).
// It does not exist until the first release PR merges, so a missing file is normal.
async function readChangelog(): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8')
  } catch {
    return null
  }
}

export default async function ChangelogPage() {
  const raw = await readChangelog()
  // Drop the generated "# Changelog" heading and the release cursor comment; the page supplies its own title.
  const body = raw?.replace(/^# Changelog\s*/, '').replace(/<!--[\s\S]*?-->/g, '').trim()

  return (
    <ContentContainer title="Changelog" description={`Current version: v${APP_VERSION}`}>
      {body ? (
        <article className="space-y-4 text-sm [&_h2]:mt-8 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:font-mono [&_h2]:text-base [&_h2]:font-medium [&_li]:ml-5 [&_li]:list-disc [&_li]:py-0.5 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline first:[&_h2]:mt-0">
          <ReactMarkdown>{body}</ReactMarkdown>
        </article>
      ) : (
        <p className="text-sm text-muted-foreground">No releases yet. Releases are published weekly.</p>
      )}
    </ContentContainer>
  )
}
