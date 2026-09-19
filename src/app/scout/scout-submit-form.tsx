'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Submission = {
  title: string
  company: string
  triageStatus: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  verdict: 'PRIORITY' | 'REVIEW' | 'PASS' | null
  feedback: string | null
}

export function ScoutSubmitForm() {
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function poll(id: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      const response = await fetch(`/api/scout/submissions/${id}`, { credentials: 'same-origin' })
      if (!response.ok) return
      const next = await response.json() as Submission
      setSubmission(next)
      if (next.triageStatus === 'COMPLETE' || next.triageStatus === 'FAILED') return
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setMessage(null)
    setSubmission(null)
    try {
      const response = await fetch('/api/scout/submissions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, note: note || undefined }),
      })
      const result = await response.json() as { submissionId?: string | null; duplicate?: boolean; error?: string }
      if (!response.ok) {
        setMessage(result.error ?? 'We could not submit that job.')
        return
      }
      if (result.duplicate) {
        setMessage('That role is already in the candidate’s list.')
        return
      }
      setMessage('Checking this role now…')
      setUrl('')
      setNote('')
      if (result.submissionId) await poll(result.submissionId)
    } catch {
      setMessage('We could not submit that job. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="job-url">Job link</Label>
        <Input id="job-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="job-note">Why it stood out (optional)</Label>
        <Input id="job-note" value={note} onChange={event => setNote(event.target.value)} maxLength={500} />
      </div>
      <Button className="w-full" type="submit" disabled={submitting}>{submitting ? 'Checking…' : 'Share role'}</Button>
      {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
      {submission && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm" role="status">
          <p className="font-medium">{submission.title} at {submission.company}</p>
          {submission.triageStatus === 'FAILED' && <p className="mt-1 text-muted-foreground">We could not check this role yet.</p>}
          {submission.verdict && <p className="mt-2 font-semibold">{submission.verdict}</p>}
          {submission.feedback && <p className="mt-1 text-muted-foreground">{submission.feedback}</p>}
        </div>
      )}
    </form>
  )
}
