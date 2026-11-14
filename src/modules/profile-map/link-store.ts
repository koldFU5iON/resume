// Stored evidence-link decisions (RoleActivitySkill rows): AI suggestions
// awaiting review, confirmed links and rejections. Session-free: every
// function takes the caller's profileId first and only touches evidence and
// capabilities that belong to it.

import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { loadVault } from './load'
import { buildSuggestionPrompt, pairKey, resolveSuggestions, SuggestionSchema, type CapabilitySuggestion } from './suggest'
import type { CapabilityKind } from './types'

export type LinkPair = { evidenceId: string; capabilityId: string }

export type PendingSuggestion = LinkPair & {
  evidence: string
  role: string
  capability: string
  reason: string | null
}

/** Keeps only pairs whose evidence and capability both belong to the profile. */
async function ownedPairs(profileId: string, pairs: LinkPair[]): Promise<LinkPair[]> {
  if (pairs.length === 0) return []
  const [evidence, capabilities] = await Promise.all([
    prisma.roleActivity.findMany({
      where: {
        id: { in: [...new Set(pairs.map((p) => p.evidenceId))] },
        OR: [{ experience: { profileId } }, { project: { profileId } }],
      },
      select: { id: true },
    }),
    prisma.skill.findMany({
      where: { id: { in: [...new Set(pairs.map((p) => p.capabilityId))] }, profileId },
      select: { id: true },
    }),
  ])
  const okEvidence = new Set(evidence.map((e) => e.id))
  const okCapability = new Set(capabilities.map((c) => c.id))
  return pairs.filter((p) => okEvidence.has(p.evidenceId) && okCapability.has(p.capabilityId))
}

async function setStatus(profileId: string, pairs: LinkPair[], status: 'confirmed' | 'rejected'): Promise<number> {
  const owned = await ownedPairs(profileId, pairs)
  await prisma.$transaction(owned.map((p) => prisma.roleActivitySkill.upsert({
    where: { roleActivityId_skillId: { roleActivityId: p.evidenceId, skillId: p.capabilityId } },
    create: { roleActivityId: p.evidenceId, skillId: p.capabilityId, status, source: 'manual' },
    update: { status },
  })))
  return owned.length
}

/** Confirms links: accepted suggestions, or links the user adds by hand. */
export function confirmLinks(profileId: string, pairs: LinkPair[]): Promise<number> {
  return setStatus(profileId, pairs, 'confirmed')
}

/** Rejects links: dismissed suggestions, or a wrong exact match the user wants gone. */
export function rejectLinks(profileId: string, pairs: LinkPair[]): Promise<number> {
  return setStatus(profileId, pairs, 'rejected')
}

/** AI suggestions awaiting review, with enough text to decide on each. */
export async function listPendingSuggestions(profileId: string): Promise<PendingSuggestion[]> {
  const rows = await prisma.roleActivitySkill.findMany({
    where: { status: 'suggested', skill: { profileId }, roleActivity: { OR: [{ experience: { profileId } }, { project: { profileId } }] } },
    select: {
      roleActivityId: true,
      skillId: true,
      reason: true,
      skill: { select: { name: true } },
      roleActivity: {
        select: {
          description: true,
          experience: { select: { role: true, company: true } },
          project: { select: { name: true, experience: { select: { role: true, company: true } } } },
        },
      },
    },
    orderBy: [{ skill: { name: 'asc' } }, { createdAt: 'asc' }],
  })
  return rows.map((r) => {
    const { experience, project } = r.roleActivity
    const owner = experience ?? project?.experience
    const role = owner ? `${owner.role} at ${owner.company}` : ''
    return {
      evidenceId: r.roleActivityId,
      capabilityId: r.skillId,
      evidence: r.roleActivity.description,
      role: project ? [project.name, role].filter(Boolean).join(' — ') : role,
      capability: r.skill.name,
      reason: r.reason,
    }
  })
}

export type SuggestResult = { links: number; newCapabilities: CapabilitySuggestion[] }

/**
 * Asks the model for links and missing capabilities, and stores the links as
 * pending suggestions in place of the previous batch. Confirmed and rejected
 * rows are never touched. New capabilities are returned, not stored: adding
 * one is the user's call (addCapabilityWithEvidence).
 */
export async function suggestLinks(profileId: string): Promise<SuggestResult> {
  const vault = await loadVault(profileId)
  if (vault.byType.evidence.length === 0 || vault.byType.capability.length === 0) {
    return { links: 0, newCapabilities: [] }
  }
  const rejectedRows = await prisma.roleActivitySkill.findMany({
    where: { status: 'rejected', skill: { profileId } },
    select: { roleActivityId: true, skillId: true },
  })
  const rejected = new Set(rejectedRows.map((r) => pairKey(r.roleActivityId, r.skillId)))

  const { prompt, refs } = buildSuggestionPrompt(vault)
  const { object } = await completeStructured(profileId, prompt, SuggestionSchema, {
    feature: 'profile-evidence-links',
    temperature: 0.2,
  })
  const suggestions = resolveSuggestions(vault, object, refs, rejected)
  const owned = await ownedPairs(profileId, suggestions.links)
  const reasons = new Map(suggestions.links.map((s) => [pairKey(s.evidenceId, s.capabilityId), s.reason]))

  await prisma.$transaction([
    prisma.roleActivitySkill.deleteMany({ where: { status: 'suggested', skill: { profileId } } }),
    prisma.roleActivitySkill.createMany({
      data: owned.map((p) => ({
        roleActivityId: p.evidenceId,
        skillId: p.capabilityId,
        status: 'suggested',
        source: 'ai',
        reason: reasons.get(pairKey(p.evidenceId, p.capabilityId)) ?? null,
      })),
      // A confirmed or rejected row for the same pair stays as it is.
      skipDuplicates: true,
    }),
  ])
  return { links: owned.length, newCapabilities: suggestions.newCapabilities }
}

/** Adds a suggested capability and confirms its links to the evidence that shows it. */
export async function addCapabilityWithEvidence(
  profileId: string,
  input: { name: string; kind: CapabilityKind; evidenceIds: string[] },
): Promise<{ id: string; linked: number }> {
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error('Name is required')
  const kind: CapabilityKind = input.kind === 'tool' || input.kind === 'competency' ? input.kind : 'skill'
  const last = await prisma.skill.findFirst({ where: { profileId, kind }, orderBy: { order: 'desc' }, select: { order: true } })
  const capability = await prisma.skill.create({
    data: {
      profileId,
      name,
      kind,
      order: (last?.order ?? -1) + 1,
      ...(kind === 'competency' ? { origin: 'derived' } : {}),
    },
    select: { id: true },
  })
  const linked = await confirmLinks(profileId, input.evidenceIds.map((evidenceId) => ({ evidenceId, capabilityId: capability.id })))
  return { id: capability.id, linked }
}
