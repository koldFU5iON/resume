'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { FullProfile } from '@/app/types/profile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup } from '@/components/ui/field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { ExternalLink, GitFork, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { updateProject, deleteProject } from '@/modules/profile/actions'
import { extractProjectInsights } from '@/modules/profile/project-extract'
import { projectHighlights } from '@/modules/profile/project-highlights'

// ── Types ─────────────────────────────────────────────────────────────────────

type ExtractState =
  | { status: 'idle' }
  | { status: 'extracting' }
  | { status: 'done'; highlights: string[]; skills: string[] }
  | { status: 'error'; message: string }

// ── ProjectCard ───────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onEdit,
  onDelete,
}: {
  project: FullProfile['projects'][number]
  onEdit: () => void
  onDelete: () => void
}) {
  const shown = projectHighlights(project.activities ?? [], project.highlights)
  return (
    <div className="group relative rounded-lg border bg-card p-4 space-y-2 hover:border-border/80 transition-colors">
      {/* Top row: name + controls */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-sm leading-tight">{project.name}</h3>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent transition-colors"
              aria-label="Visit project"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {project.repoUrl && (
            <a
              href={project.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent transition-colors"
              aria-label="View repository"
            >
              <GitFork size={12} />
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit project">
            <Pencil size={12} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={onDelete} aria-label="Delete project">
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Description (truncated) */}
      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
      )}

      {/* Evidence the project owns, falling back to the legacy highlights */}
      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.slice(0, 3).map((h, i) => (
            <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
              <span className="shrink-0 mt-0.5">•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Skill tags */}
      {project.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {project.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ProjectDialog ─────────────────────────────────────────────────────────────

type ProjectDialogProps = {
  open: boolean
  onOpenChange: ((o: boolean) => void) | undefined
  editing: FullProfile['projects'][number] | null
  onSave: (data: Parameters<typeof updateProject>[1]) => void
  saving: boolean
  saveError: string | null
  hasLLMKey: boolean
}

function ProjectDialog({ open, onOpenChange, editing, onSave, saving, saveError, hasLLMKey }: ProjectDialogProps) {
  const [highlights, setHighlights] = useState<string[]>(editing?.highlights ?? [])
  const evidence = (editing?.activities ?? []).map(a => a.description)
  const [tags, setTags] = useState<string[]>(editing?.tags ?? [])
  const [extractState, setExtractState] = useState<ExtractState>({ status: 'idle' })
  const [nameValue, setNameValue] = useState(editing?.name ?? '')
  const [descValue, setDescValue] = useState(editing?.description ?? '')

  // Extract writes the legacy highlights column, which nothing shows once the project owns evidence.
  const hasEvidence = evidence.length > 0

  const handleExtract = async () => {
    if (hasEvidence || !nameValue.trim() || !descValue.trim()) return
    setExtractState({ status: 'extracting' })
    const result = await extractProjectInsights(nameValue, descValue)
    if (result.ok) {
      setHighlights(result.highlights)
      setTags(result.skills)
      setExtractState({ status: 'done', highlights: result.highlights, skills: result.skills })
    } else {
      setExtractState({ status: 'error', message: result.message })
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const startStr = fd.get('startDate') as string
    const endStr = fd.get('endDate') as string
    onSave({
      name: nameValue,
      description: descValue,
      url: (fd.get('url') as string) || undefined,
      repoUrl: (fd.get('repoUrl') as string) || undefined,
      startDate: startStr ? new Date(startStr) : undefined,
      endDate: endStr ? new Date(endStr) : undefined,
      highlights,
      tags,
    })
  }

  const removeHighlight = (i: number) => setHighlights(h => h.filter((_, idx) => idx !== i))
  const removeTag = (t: string) => setTags(ts => ts.filter(tag => tag !== t))

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Project' : 'Add Project'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="proj-name">Project Name</Label>
              <Input
                id="proj-name"
                name="name"
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea
                id="proj-desc"
                name="description"
                value={descValue}
                onChange={e => setDescValue(e.target.value)}
                rows={4}
                placeholder="Describe what you built, the problem it solved, the tech stack, and your role…"
              />
            </Field>

            {/* Extract insights button */}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={hasEvidence || extractState.status === 'extracting' || !descValue.trim() || !nameValue.trim() || !hasLLMKey}
                onClick={handleExtract}
                title={!hasLLMKey ? 'Configure an LLM API key in Settings to use extraction' : undefined}
                aria-describedby={hasEvidence ? 'proj-extract-note' : undefined}
              >
                <Sparkles size={13} />
                {extractState.status === 'extracting' ? 'Extracting…' : 'Extract Insights'}
              </Button>
              {hasEvidence && (
                <p id="proj-extract-note" className="mt-1.5 text-xs text-muted-foreground">
                  Extract is off because this project has evidence. Edit its evidence instead.
                </p>
              )}
              {extractState.status === 'error' && (
                <p className="mt-1.5 text-xs text-destructive">{extractState.message}</p>
              )}
            </div>

            {/* Project-owned evidence is read-only here; it is edited with the Evidence tab. */}
            {evidence.length > 0 && (
              <div className="space-y-1.5">
                <Label>Evidence</Label>
                <div className="space-y-1">
                  {evidence.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 mt-0.5 text-muted-foreground">•</span>
                      <span className="flex-1">{h}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Highlights — show if any exist */}
            {evidence.length === 0 && highlights.length > 0 && (
              <div className="space-y-1.5">
                <Label>Highlights</Label>
                <div className="space-y-1">
                  {highlights.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 mt-0.5 text-muted-foreground">•</span>
                      <span className="flex-1">{h}</span>
                      <button
                        type="button"
                        onClick={() => removeHighlight(i)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Remove highlight"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skill tags — show if any exist */}
            {tags.length > 0 && (
              <div className="space-y-1.5">
                <Label>Skills</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(tag => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1 pr-1 cursor-default text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={`Remove ${tag}`}
                        className="hover:text-destructive transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Optional URLs */}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="proj-url">Live URL</Label>
                <Input id="proj-url" name="url" type="url" placeholder="https://…" defaultValue={editing?.url ?? ''} />
              </Field>
              <Field>
                <Label htmlFor="proj-repo">Repository URL</Label>
                <Input id="proj-repo" name="repoUrl" type="url" placeholder="https://github.com/…" defaultValue={editing?.repoUrl ?? ''} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="proj-start">Start Date</Label>
                <Input
                  id="proj-start"
                  name="startDate"
                  type="date"
                  defaultValue={editing?.startDate ? new Date(editing.startDate).toISOString().split('T')[0] : ''}
                />
              </Field>
              <Field>
                <Label htmlFor="proj-end">End Date</Label>
                <Input
                  id="proj-end"
                  name="endDate"
                  type="date"
                  defaultValue={editing?.endDate ? new Date(editing.endDate).toISOString().split('T')[0] : ''}
                />
              </Field>
            </div>
          </FieldGroup>

          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}

          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── ProjectDetails ────────────────────────────────────────────────────────────

/** One project's card with its edit dialog: the details region of a project note. */
export function ProjectDetails({
  project: initial,
  hasLLMKey,
  onDeleted,
}: {
  project: FullProfile['projects'][number]
  hasLLMKey: boolean
  /** Called after the project is deleted; the page it lived on no longer exists. */
  onDeleted: () => void
}) {
  const router = useRouter()
  const [project, setProject] = useState(initial)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleteError(null)
    try {
      await deleteProject(project.id)
      onDeleted()
    } catch {
      setDeleteError('Failed to delete project. Please try again.')
    }
  }

  const handleSave = async (data: Parameters<typeof updateProject>[1]) => {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateProject(project.id, data)
      setProject({ ...updated, activities: project.activities, highlights: data.highlights ?? [], tags: data.tags ?? [] })
      setOpen(false)
      router.refresh()
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
      <ProjectCard
        project={project}
        onEdit={() => { setSaveError(null); setOpen(true) }}
        onDelete={() => void handleDelete()}
      />
      <ProjectDialog
        key={project.id}
        open={open}
        onOpenChange={saving ? undefined : setOpen}
        editing={project}
        onSave={handleSave}
        saving={saving}
        saveError={saveError}
        hasLLMKey={hasLLMKey}
      />
    </div>
  )
}
