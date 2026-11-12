import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/session'
import { prisma } from '@/lib/db'
import { createSession } from '@/modules/interview-prep/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LegacyEditorNotice } from '@/components/legacy-editors/deprecation'

type Props = { searchParams: Promise<{ jobId?: string }> }

export default async function NewInterviewPrepPage({ searchParams }: Props) {
  const [{ jobId }, { profile }] = await Promise.all([searchParams, requireProfile()])

  const jobs = await prisma.jobApplication.findMany({
    where: {
      profileId: profile.id,
      archivedAt: null,
      status: { in: ['applied', 'interviewing'] },
    },
    orderBy: { lastUpdated: 'desc' },
    select: { id: true, title: true, company: true, status: true },
    take: 50,
  })

  const preselectedJob = jobId ? jobs.find(j => j.id === jobId) : undefined
  const defaultTitle = preselectedJob
    ? `${preselectedJob.title}${preselectedJob.company ? ` @ ${preselectedJob.company}` : ''}`
    : ''

  async function handleCreate(formData: FormData) {
    'use server'
    const title = formData.get('title') as string
    const jobApplicationId = (formData.get('jobApplicationId') as string) || undefined
    if (!title?.trim()) return
    const { id } = await createSession({ title: title.trim(), jobApplicationId })
    redirect(`/dashboard/interview-prep/${id}`)
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 md:px-6">
      <LegacyEditorNotice kind="interview-prep" className="mb-6 rounded-lg border" />
      <h1 className="mb-6 text-xl font-semibold">New Prep Session</h1>
      <form action={handleCreate} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">Session title</Label>
          <Input
            id="title"
            name="title"
            placeholder="e.g. Senior Product Designer @ Acme"
            defaultValue={defaultTitle}
            required
            autoFocus
          />
        </div>

        {jobs.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="jobApplicationId">Link to a job (optional)</Label>
            <select
              id="jobApplicationId"
              name="jobApplicationId"
              defaultValue={preselectedJob?.id ?? ''}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {jobs.map(job => (
                <option key={job.id} value={job.id}>
                  {job.title}{job.company ? ` · ${job.company}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Only showing jobs marked as Applied or Interviewing.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="submit">Create session</Button>
          <Button type="button" variant="ghost" render={<Link href="/dashboard/interview-prep" />}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
