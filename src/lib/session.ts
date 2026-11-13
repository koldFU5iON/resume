import { cache } from "react"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function requireSession() {
  const session = await getSession()
  if (!session) throw new Error("Unauthorized")
  return session
}

async function requireProfileUncached() {
  const session = await requireSession()
  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
  })
  if (!profile) throw new Error("Profile not found for user")
  return { session, profile }
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  return user?.role === 'admin'
}


/** Deduplicated per request: the job workspace layout and its pages both call this. */
export const requireProfile = cache(requireProfileUncached)
