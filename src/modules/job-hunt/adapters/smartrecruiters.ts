import type { JobListing } from '../schema'

export async function fetchJobList(companySlug: string): Promise<JobListing[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?status=PUBLIC&limit=100`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`SmartRecruiters returned ${res.status}`)
  const data = (await res.json()) as { content?: unknown[] }
  return (data.content ?? []).map((j) => {
    const job = j as Record<string, unknown>
    const loc = job.location as Record<string, unknown> | undefined
    const location = loc?.remote === true
      ? 'Remote'
      : [loc?.city, loc?.country].filter(Boolean).join(', ') || null
    const rawDate = typeof job.releasedDate === 'string' ? job.releasedDate : null
    const parsed = rawDate ? new Date(rawDate) : null
    return {
      externalId: String(job.id ?? ''),
      title: String(job.name ?? ''),
      location: location as string | null,
      // `ref` is the API URL (JSON), not a page anyone can apply on.
      url: job.id ? `https://jobs.smartrecruiters.com/${companySlug}/${String(job.id)}` : null,
      postedAt: parsed && !isNaN(parsed.getTime()) ? parsed : null,
    }
  })
}

export async function fetchDescription(companySlug: string, jobId: string): Promise<string | null> {
  const url = `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings/${jobId}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as Record<string, unknown>
  const sections = (data.jobAd as Record<string, unknown> | undefined)?.sections as Record<string, unknown> | undefined
  const desc = sections?.jobDescription as Record<string, unknown> | undefined
  return typeof desc?.text === 'string' ? desc.text : null
}
