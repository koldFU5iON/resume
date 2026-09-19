import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SCOUT_COOKIE_NAME, verifyScoutInvite } from '@/modules/scout-inbox/service'
import { ScoutSubmitForm } from './scout-submit-form'

export default async function ScoutPage() {
  const token = (await cookies()).get(SCOUT_COOKIE_NAME)?.value
  const invite = await verifyScoutInvite(token)
  if (!invite) redirect('/')

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scout Inbox</p>
        <h1 className="mt-2 text-2xl font-semibold">Share a job</h1>
        <p className="mt-2 text-sm text-muted-foreground">Send one job posting at a time. We&apos;ll check it and let you know what happens next.</p>
        <ScoutSubmitForm />
      </section>
    </main>
  )
}
