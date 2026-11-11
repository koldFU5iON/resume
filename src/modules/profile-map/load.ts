import { cache } from 'react'
import { prisma } from '@/lib/db'
import { buildVault } from './build'
import { VAULT_INCLUDE } from './source'
import type { Vault } from './types'

/**
 * The one profile loader. Callers pass a profileId they have already
 * authorised (session or token); every query is scoped by it.
 *
 * Wrapped in React `cache()`: within one server request the vault is loaded
 * once, however many features ask for it (CV generation, cover-letter stages
 * and the writing desk all used to rebuild it several times). Outside a
 * request, `cache()` simply calls through.
 */
export const loadVault = cache(async (profileId: string): Promise<Vault> => {
  const row = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: VAULT_INCLUDE,
  })
  return buildVault(row)
})
