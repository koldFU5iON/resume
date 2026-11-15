// The one order evidence is read in: starred first, then the order the person
// gave it. The vault, the profile page and the CV snapshot all read through
// this, so the same evidence never appears in two orders.

import type { Prisma } from '@prisma/client'

export const ACTIVITY_ORDER = [{ highlighted: 'desc' }, { order: 'asc' }] satisfies Prisma.RoleActivityOrderByWithRelationInput[]
