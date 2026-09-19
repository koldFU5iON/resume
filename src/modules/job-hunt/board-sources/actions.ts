// src/modules/job-hunt/board-sources/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { decrypt } from '@/lib/encryption'
import {
  JobHuntSearchCriteriaSchema,
  normalizeJobBoardApiKeys,
  type JobHuntSearchCriteria,
} from './schema'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { getBoardAdapter } from '../board-adapters/index'
import type { ScanResult } from '../schema'

type ToggleResult = { ok: true } | { ok: false; error: 'not_found' }

export async function toggleBoardSource(sourceId: string): Promise<ToggleResult> {
  const { profile } = await requireProfile()
  const source = await prisma.jobBoardSource.findFirst({
    where: { id: sourceId, profileId: profile.id },
  })
  if (!source) return { ok: false, error: 'not_found' }
  await prisma.jobBoardSource.update({
    where: { id: sourceId },
    data: { enabled: !source.enabled },
  })
  revalidatePath('/dashboard/job-hunt')
  return { ok: true }
}

export async function saveJobHuntSearch(criteria: JobHuntSearchCriteria): Promise<void> {
  const parsed = JobHuntSearchCriteriaSchema.safeParse(criteria)
  if (!parsed.success) return
  const { profile } = await requireProfile()
  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, jobHuntSearch: parsed.data },
    update: { jobHuntSearch: parsed.data },
  })
  revalidatePath('/dashboard/job-hunt')
}

export async function scanBoardSource(sourceId: string): Promise<ScanResult> {
  const { profile } = await requireProfile()

  const [source, settings] = await Promise.all([
    prisma.jobBoardSource.findFirst({
      where: { id: sourceId, profileId: profile.id, enabled: true },
    }),
    prisma.userSettings.findUnique({
      where: { profileId: profile.id },
      select: { searchProfile: true, jobBoardApiKeys: true },
    }),
  ])

  if (!source) return { ok: false, error: 'not_found' }

  const adapter = getBoardAdapter(source.provider)
  if (!adapter) return { ok: false, error: 'no_ats_detected' }

  const apiKeys = normalizeJobBoardApiKeys(settings?.jobBoardApiKeys)
  const rawJSearchKey = apiKeys.jsearch ?? null
  const jSearchKey = rawJSearchKey ? decrypt(rawJSearchKey) : null
  const apiKey = source.provider === 'jsearch' ? jSearchKey : null

  if (source.provider === 'jsearch' && rawJSearchKey && jSearchKey === null) {
    return { ok: false, error: 'key_invalid' }
  }
  if (!adapter.isAvailable(apiKey)) return { ok: false, error: 'no_ats_detected' }

  const sp = normalizeSearchProfile(settings?.searchProfile)
  const criteria: JobHuntSearchCriteria = {
    roles: sp.roles,
    locations: sp.countries,
    datePosted: 'last30',
    minSalary: sp.salaryBand?.min ?? null,
  }

  let listings
  try {
    listings = await adapter.fetchJobs(criteria, apiKey)
  } catch (err) {
    if (err instanceof Error && err.message === 'key_invalid') {
      return { ok: false, error: 'key_invalid' }
    }
    await prisma.jobBoardSource.update({
      where: { id: sourceId },
      data: { lastScanError: err instanceof Error ? err.message : 'fetch_failed', lastScannedAt: new Date() },
    })
    return { ok: false, error: 'fetch_failed' }
  }

  const existing = await prisma.discoveredJob.findMany({
    where: { boardSourceId: sourceId },
    select: { externalId: true },
  })
  const existingIds = new Set(existing.map((e) => e.externalId))
  const newListings = listings.filter((j) => !existingIds.has(j.externalId))

  if (newListings.length > 0) {
    await prisma.discoveredJob.createMany({
      data: newListings.map((j) => ({
        boardSourceId: sourceId,
        profileId: profile.id,
        source: 'BOARD',
        externalId: j.externalId,
        title: j.title,
        company: j.company,
        location: j.location,
        salary: j.salary,
        url: j.url,
        postedAt: j.postedAt,
        status: 'new',
      })),
    })
  }

  await prisma.jobBoardSource.update({
    where: { id: sourceId },
    data: { lastScannedAt: new Date(), lastScanError: null },
  })

  revalidatePath('/dashboard/job-hunt')
  return {
    ok: true,
    found: listings.length,
    matched: listings.length,
    newJobs: newListings.length,
  }
}
