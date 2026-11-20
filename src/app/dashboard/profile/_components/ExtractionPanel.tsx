'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { extractFromNotes, reviewExtractionItem } from '@/modules/profile/extract'
import type { ExtractionReview } from '@/modules/profile/extraction-draft'
import type { DraftChange, DraftItem, ExtractionOwner } from '@/modules/profile/extract-schema'
import { combineImpact } from '@/modules/profile/result'
import { selectClass } from './PropertyFields'

const kinds = { achievement: 'Achievement', scope: 'Scope', skill: 'Skill' }
const actionSize = 'max-md:h-11'
const emptyResult = { measure: '', value: '', baseline: '', period: '' }
const resultFields = [
  ['measure', 'What it measures', 120],
  ['value', 'Result', 80],
  ['baseline', 'Started at', 80],
  ['period', 'Period', 80],
] as const

type Stamp = Pick<ExtractionReview, 'version' | 'sourceVersion'>

function SuggestionEdit({ item, projects, disabled, canSave, onSave, onCancel }: {
  item: DraftItem
  projects: ExtractionReview['projects']
  disabled: boolean
  canSave: boolean
  onSave: (edit: DraftChange['edit']) => void
  onCancel: () => void
}) {
  const id = useId()
  const [edit, setEdit] = useState(item)
  const [result, setResult] = useState(() => item.kind === 'achievement' ? item.result ?? emptyResult : emptyResult)
  const hasResult = Object.values(result).some((value) => value?.trim())
  const selectedProjectId = edit.kind === 'achievement' && edit.project?.kind === 'existing' ? edit.project.id : null

  return (
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!canSave) return
      onSave(edit.kind === 'achievement' ? { ...edit, result: hasResult ? result : null } : edit)
    }}>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <legend className="sr-only">Edit {kinds[item.kind].toLowerCase()} suggestion</legend>
        {edit.kind === 'skill' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Skill name</Label>
              <Input id={`${id}-name`} value={edit.name} maxLength={120} required autoFocus className={actionSize} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-category`}>Category</Label>
              <Input id={`${id}-category`} value={edit.category ?? ''} maxLength={80} className={actionSize} onChange={(e) => setEdit({ ...edit, category: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-level`}>Level</Label>
              <select id={`${id}-level`} className={selectClass} value={edit.level ?? ''} onChange={(e) => setEdit({ ...edit, level: (e.target.value || null) as typeof edit.level })}>
                <option value="">Unspecified</option>
                {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map((level) => <option key={level}>{level}</option>)}
              </select>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={`${id}-description`}>Cleaned wording</Label>
            <Textarea id={`${id}-description`} required autoFocus rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </div>
        )}
        {edit.kind === 'achievement' && (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${id}-impact`}>Outcome (optional)</Label>
              <Input id={`${id}-impact`} value={edit.impact ?? ''} className={actionSize} onChange={(e) => setEdit({ ...edit, impact: e.target.value || null })} />
            </div>
            <fieldset className="grid min-w-0 gap-2 @min-[26rem]:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Structured result (optional)</legend>
              {resultFields.map(([field, label, maxLength]) => (
                <div key={field} className="min-w-0 space-y-1">
                  <Label htmlFor={`${id}-${field}`}>{label}</Label>
                  <Input id={`${id}-${field}`} maxLength={maxLength} className={actionSize} value={result[field] ?? ''}
                    required={hasResult && (field === 'measure' || field === 'value')}
                    onChange={(e) => setResult({ ...result, [field]: e.target.value })} />
                </div>
              ))}
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor={`${id}-project`}>Project label</Label>
              <select id={`${id}-project`} className={selectClass}
                value={selectedProjectId ? `project:${selectedProjectId}` : edit.project?.kind ?? ''}
                onChange={(e) => {
                  const value = e.target.value
                  const project = value === 'new' ? { kind: 'new' as const, name: '' }
                    : value ? { kind: 'existing' as const, id: value.slice('project:'.length) } : null
                  setEdit({ ...edit, project, projectEdited: true })
                }}>
                <option value="">No project</option>
                {selectedProjectId && !projects.some((project) => project.id === selectedProjectId) && (
                  <option value={`project:${selectedProjectId}`} disabled>Unavailable project</option>
                )}
                {projects.map((project) => <option key={project.id} value={`project:${project.id}`}>{project.name}</option>)}
                <option value="new">New project…</option>
              </select>
            </div>
            {edit.project?.kind === 'new' && (
              <div className="space-y-1">
                <Label htmlFor={`${id}-project-name`}>New project name</Label>
                <Input id={`${id}-project-name`} required maxLength={160} className={actionSize} value={edit.project.name}
                  onChange={(e) => setEdit({ ...edit, project: { kind: 'new', name: e.target.value }, projectEdited: true })} />
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" className={actionSize} disabled={!canSave}>Save edits</Button>
          <Button type="button" variant="ghost" size="sm" className={actionSize} onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
    </form>
  )
}

export function ExtractionPanel({ owner, review }: { owner: ExtractionOwner; review: ExtractionReview }) {
  const router = useRouter()
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = useRef(false)
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<{ id: string; stamp: Stamp } | null>(null)
  const [confirm, setConfirm] = useState<Stamp | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const stamp = { version: review.version, sourceVersion: review.sourceVersion }
  const activeEditing = editing && review.items.some(({ item }) => item.id === editing.id) ? editing : null
  const disabled = pending || activeEditing !== null || confirm !== null

  function run(operation: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) {
    if (busy.current) return
    busy.current = true
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await operation()
        if (!result.ok) {
          setMessage({ text: result.message, error: true })
          return
        }
        setConfirm(null)
        setEditing(null)
        setMessage({ text: success, error: false })
        heading.current?.focus()
      } catch {
        setMessage({ text: 'Could not update the draft. Reload it to check whether your change was saved.', error: true })
      } finally {
        busy.current = false
      }
    })
  }

  function decide(item: DraftItem, decision: DraftChange['decision'], success: string, target?: DraftChange['target']) {
    run(() => reviewExtractionItem(owner, { ...stamp, itemId: item.id, decision, target }), success)
  }

  return (
    <section className="@container space-y-3 border-t pt-4" aria-labelledby="extraction-heading" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="extraction-heading" ref={heading} tabIndex={-1} className="text-sm font-semibold">Extraction draft</h3>
        <Button type="button" variant="outline" size="sm" className={actionSize} disabled={disabled || review.archived}
          onClick={() => review.items.length ? setConfirm(stamp) : run(() => extractFromNotes(owner, stamp, false), 'Extraction complete.')}>
          {review.version ? 'Extract again' : 'Extract from saved note'}
        </Button>
      </div>
      {confirm && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">Extract again and replace pending suggestions and their edits?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className={actionSize} disabled={pending}
              onClick={() => run(() => extractFromNotes(owner, confirm, true), 'Draft refreshed.')}>Replace pending suggestions</Button>
            <Button size="sm" variant="ghost" className={actionSize} disabled={pending} onClick={() => { setConfirm(null); heading.current?.focus() }}>Cancel</Button>
          </div>
        </div>
      )}
      {review.archived && <p className="text-sm text-muted-foreground">This project is archived. You can still review the saved draft.</p>}
      {review.stale && review.items.length > 0 && <p className="text-sm text-muted-foreground">The saved note changed. Extract again before accepting suggestions.</p>}
      {review.notice && <p className="text-xs text-muted-foreground">{review.notice}</p>}
      {pending && <p role="status" className="text-sm text-muted-foreground">Updating draft…</p>}
      {message && (
        <div className="space-y-1">
          <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message.text}</p>
          {message.error && <Button variant="outline" size="sm" className={actionSize} disabled={pending} onClick={() => {
            setConfirm(null)
            setMessage(null)
            startTransition(() => router.refresh())
          }}>Reload draft</Button>}
        </div>
      )}
      {review.version > 0 && review.items.length === 0 && <p className="text-sm text-muted-foreground">No pending suggestions.</p>}
      <ul className="divide-y">
        {review.items.map(({ item, match }) => {
          const activeEdit = activeEditing?.id === item.id ? activeEditing : null
          const canSave = !activeEdit || (activeEdit.stamp.version === stamp.version && activeEdit.stamp.sourceVersion === stamp.sourceVersion)
          const project = item.kind === 'achievement' ? item.project : null
          const projectText = project?.kind === 'new' ? `New project: ${project.name}`
            : project ? review.projects.find((p) => p.id === project.id)?.name ?? 'Unavailable project' : null
          const impact = item.kind === 'achievement' ? combineImpact(item.impact, item.result) : null
          const text = item.kind === 'skill' ? item.name : item.description
          return (
            <li key={item.id} className="space-y-3 py-3">
              <h4 className="text-xs font-medium text-muted-foreground">{kinds[item.kind]}</h4>
              <div className="grid gap-3 @min-[26rem]:grid-cols-2">
                {item.original && (
                  <div className="min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground">Original wording</p>
                    <blockquote className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.original}</blockquote>
                  </div>
                )}
                {!activeEdit && (
                  <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                    {item.kind !== 'skill' && <p className="text-xs text-muted-foreground">Cleaned wording</p>}
                    <p className="text-sm">{text}</p>
                    {impact && <p className="text-xs text-muted-foreground">{impact}</p>}
                    {projectText && <p className="text-xs text-muted-foreground">{projectText}</p>}
                    {item.kind === 'skill' && (item.category || item.level) && <p className="text-xs text-muted-foreground">{[item.category, item.level].filter(Boolean).join(' · ')}</p>}
                  </div>
                )}
              </div>
              {activeEdit ? (
                <>
                  {!canSave && <p role="status" className="text-sm text-muted-foreground">The saved version changed. Copy any edits you want to keep, then cancel and reopen the suggestion.</p>}
                  <SuggestionEdit item={item} projects={review.projects} disabled={pending} canSave={canSave}
                    onCancel={() => { setEditing(null); heading.current?.focus() }}
                    onSave={(edit) => run(() => reviewExtractionItem(owner, { ...activeEdit.stamp, itemId: item.id, decision: 'save', edit }), 'Draft edits saved.')} />
                </>
              ) : (
                <>
                  {match && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {match.replaceable ? 'Similar profile evidence' : 'Match unavailable for replacement'}{match.project ? ` · ${match.project}` : ''} — {match.text}
                    {match.replaceable && item.kind === 'achievement' && !item.projectEdited && ' Replacement keeps the existing project label.'}
                  </p>}
                  <div className="flex flex-wrap gap-2">
                    {!match && <Button size="sm" className={actionSize} disabled={disabled || review.stale || review.archived}
                      onClick={() => decide(item, 'accept', item.kind === 'scope' ? 'Scope added to the note.' : 'Suggestion accepted.')}>
                      {item.kind === 'scope' ? 'Add to Overview' : 'Accept'}
                    </Button>}
                    {match?.replaceable && <Button size="sm" variant="outline" className={actionSize} disabled={disabled || review.stale || review.archived}
                      onClick={() => decide(item, 'replace', 'Existing evidence updated.', { id: match.id, version: match.version })}>Replace match</Button>}
                    <Button size="sm" variant="outline" className={actionSize} disabled={disabled}
                      onClick={() => setEditing({ id: item.id, stamp })}>Edit</Button>
                    <Button size="sm" variant="ghost" className={actionSize} disabled={disabled}
                      onClick={() => decide(item, 'skip', 'Suggestion skipped.')}>Skip</Button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
