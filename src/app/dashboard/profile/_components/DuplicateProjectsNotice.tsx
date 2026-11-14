'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { mergeDuplicateProjects } from '@/modules/profile/actions'
import type { DuplicateProjectPair } from '@/modules/profile/project-merge'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function BodyChoice({
  id, label, name, body, checked, onChange, showRadio,
}: {
  id: string
  label: string
  name: string
  body: string
  checked: boolean
  onChange: () => void
  showRadio: boolean
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start gap-2 text-sm">
        {showRadio && (
          <input id={id} type="radio" name="merge-body" className="mt-1" checked={checked} onChange={onChange} />
        )}
        <label htmlFor={showRadio ? id : undefined} className="min-w-0">
          <span className="block text-xs text-muted-foreground">{label}</span>
          <span className="block font-medium">{name}</span>
        </label>
      </div>
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
        {body || <span className="text-muted-foreground">No text.</span>}
      </div>
    </div>
  )
}

function PairForm({
  pair, merging, error, onMerge, onSkip,
}: {
  pair: DuplicateProjectPair
  merging: boolean
  error: string | null
  onMerge: (body: 'keep' | 'remove') => void
  onSkip: () => void
}) {
  const [body, setBody] = useState<'keep' | 'remove'>('keep')
  const { standalone, roleProject } = pair
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <BodyChoice
          id="body-keep" showRadio={!pair.sameBody} checked={body === 'keep'} onChange={() => setBody('keep')}
          label={`Project under ${roleProject.role || 'a role'} (kept)`} name={roleProject.name} body={roleProject.body}
        />
        <BodyChoice
          id="body-remove" showRadio={!pair.sameBody} checked={body === 'remove'} onChange={() => setBody('remove')}
          label="Standalone copy (merged in, then deleted)" name={standalone.name} body={standalone.body}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {pair.sameBody
          ? 'Both have the same text, so there is nothing to choose. '
          : 'Choose which text the merged project keeps. '}
        {standalone.evidenceCount > 0
          ? `${plural(standalone.evidenceCount, 'evidence item')} move to the kept project; any it already has are not repeated. `
          : ''}
        Capability links and any empty dates or URLs carry over.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="secondary" disabled={merging}>Close</Button>} />
        <Button type="button" variant="outline" disabled={merging} onClick={onSkip}>Skip this pair</Button>
        <Button type="button" disabled={merging} onClick={() => onMerge(pair.sameBody ? 'keep' : body)}>
          {merging ? 'Merging…' : 'Merge'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Nothing is merged without a click: this only lists pairs and asks, one at a time. */
export function DuplicateProjectsNotice({ pairs }: { pairs: DuplicateProjectPair[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remaining = pairs.filter(p => !skipped.includes(p.standalone.id))
  const current = remaining[0]
  if (pairs.length === 0) return null

  async function merge(body: 'keep' | 'remove') {
    if (!current) return
    setMerging(true)
    setError(null)
    try {
      await mergeDuplicateProjects({ keepId: current.roleProject.id, removeId: current.standalone.id, body })
      router.refresh()
    } catch {
      setError('Failed to merge these projects. Please try again.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <p className="min-w-0 flex-1">
          {plural(pairs.length, 'standalone project')} look{pairs.length === 1 ? 's' : ''} like{' '}
          {pairs.length === 1 ? 'a copy' : 'copies'} of {pairs.length === 1 ? 'a project' : 'projects'} under a role.
          Merge {pairs.length === 1 ? 'it' : 'them'} so each project keeps one set of evidence.
        </p>
        <Button size="sm" variant="outline" onClick={() => { setSkipped([]); setOpen(true) }}>Review</Button>
      </div>
      <Dialog open={open && Boolean(current)} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>Merge duplicate project?</DialogTitle>
                <DialogDescription>
                  {remaining.length > 1 ? `${remaining.length} pairs to review. ` : ''}
                  &ldquo;{current.standalone.name}&rdquo; looks like an earlier copy of &ldquo;{current.roleProject.name}&rdquo;.
                </DialogDescription>
              </DialogHeader>
              <PairForm
                key={current.standalone.id}
                pair={current}
                merging={merging}
                error={error}
                onMerge={merge}
                onSkip={() => { setError(null); setSkipped(s => [...s, current.standalone.id]) }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
