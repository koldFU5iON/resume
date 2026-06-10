'use server'

import { requireProfile } from '@/lib/session'

export type FeedbackType = 'bug' | 'idea' | 'other'

export type CreateFeedbackResult =
  | { ok: true }
  | { ok: false; message: string }

const LABEL_MAP: Record<FeedbackType, string[]> = {
  bug: ['bug', 'user-reported'],
  idea: ['enhancement', 'user-reported'],
  other: ['user-reported'],
}

export async function createFeedbackIssue(
  type: FeedbackType,
  title: string,
  description: string,
  currentPath: string,
): Promise<CreateFeedbackResult> {
  await requireProfile()

  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    return { ok: false, message: 'Title is required.' }
  }
  const safePath = currentPath.startsWith('/') ? currentPath.slice(0, 200) : '(unknown)'

  const token = process.env.GITHUB_ISSUE_TOKEN
  if (!token) {
    return { ok: false, message: 'Issue reporting is not configured.' }
  }

  const bodyLines: string[] = []
  if (description.trim()) {
    bodyLines.push(description.trim(), '')
  }
  bodyLines.push(
    '---',
    `**Filed from:** ${safePath}`,
    `**Submitted:** ${new Date().toISOString()}`,
  )

  try {
    const res = await fetch('https://api.github.com/repos/koldFU5iON/resume/issues', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        title: trimmedTitle,
        body: bodyLines.join('\n'),
        labels: LABEL_MAP[type],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)')
      console.error(`GitHub Issues API error ${res.status}: ${text}`)
      return { ok: false, message: 'GitHub returned an error. Try the fallback link.' }
    }

    return { ok: true }
  } catch (err) {
    console.error('createFeedbackIssue network error:', err)
    return { ok: false, message: 'Network error. Try the fallback link.' }
  }
}
