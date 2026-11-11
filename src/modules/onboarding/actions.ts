"use server"

import { Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import {
  normalizeOnboardingContext,
  type OnboardingContext,
} from "@/modules/onboarding/schema"

function readFormData(formData: FormData): OnboardingContext {
  return normalizeOnboardingContext({
    preferredName: formData.get("preferredName"),
    currentRole: formData.get("currentRole"),
    targetRole: formData.get("targetRole"),
    industries: formData.get("industries"),
    workPreferences: formData.get("workPreferences"),
    extraContext: formData.get("extraContext"),
  })
}

export async function saveOnboardingContext(formData: FormData) {
  const { profile } = await requireProfile()

  // Read existing context to preserve fields managed elsewhere (e.g. additionalRoles
  // from the Job Hunt page) that the onboarding form doesn't include.
  const existing = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { onboardingContext: true },
  })
  const currentContext = normalizeOnboardingContext(existing?.onboardingContext)
  const formContext = readFormData(formData)
  const context = { ...currentContext, ...formContext }

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: {
      profileId: profile.id,
      onboardingContext: context,
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
    update: {
      onboardingContext: context,
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/onboarding")
  redirect("/dashboard")
}

export async function skipOnboarding() {
  const { profile } = await requireProfile()

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: {
      profileId: profile.id,
      onboardingContext: Prisma.JsonNull,
      onboardingCompletedAt: null,
      onboardingSkippedAt: new Date(),
    },
    update: {
      onboardingSkippedAt: new Date(),
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/onboarding")
  redirect("/dashboard")
}

export async function clearOnboardingContext() {
  const { profile } = await requireProfile()

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: {
      profileId: profile.id,
      onboardingContext: Prisma.JsonNull,
      onboardingCompletedAt: null,
      onboardingSkippedAt: new Date(),
    },
    update: {
      onboardingContext: Prisma.JsonNull,
      onboardingCompletedAt: null,
      onboardingSkippedAt: new Date(),
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/onboarding")
  redirect("/dashboard/onboarding")
}

export async function saveOnboardingContextData(data: Partial<OnboardingContext>) {
  const { profile } = await requireProfile()

  const existing = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { onboardingContext: true },
  })
  const currentContext = normalizeOnboardingContext(existing?.onboardingContext)
  // `data` comes from the client: validate the merged result, dropping unknown keys.
  const context = normalizeOnboardingContext({ ...currentContext, ...data })

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: {
      profileId: profile.id,
      onboardingContext: context,
    },
    update: {
      onboardingContext: context,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/onboarding")
}

const ONBOARDING_DESTINATIONS = [
  "/dashboard",
  "/dashboard/job-applications",
  "/dashboard/job-hunt",
] as const

export async function completeOnboarding(destination: string) {
  const { profile } = await requireProfile()

  const safeDestination = (ONBOARDING_DESTINATIONS as readonly string[]).includes(destination)
    ? destination
    : "/dashboard"

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: {
      profileId: profile.id,
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
    update: {
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/onboarding")
  redirect(safeDestination)
}
