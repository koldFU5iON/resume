'use client'

import { useState, useMemo, type FormEvent } from 'react'
import type { FullProfile } from '@/app/types/profile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Field, FieldGroup } from '@/components/ui/field'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  createSkill, updateSkill, deleteSkill,
  createTool, updateTool, deleteTool,
  createLanguage, updateLanguage, deleteLanguage,
  createCompetency, updateCompetency, deleteCompetency,
  createEducation, updateEducation, deleteEducation,
  createCertification, updateCertification, deleteCertification,
} from '@/modules/profile/actions'
import { SectionHelp } from './SectionHelp'

// ── Types ─────────────────────────────────────────────────────────────────────

type SkillType = FullProfile['skills'][number]
type ToolType = FullProfile['tools'][number]
type LanguageType = FullProfile['languages'][number]
type CompetencyType = FullProfile['competencies'][number]
type EducationType = FullProfile['educations'][number]
type CertType = FullProfile['certifications'][number]

// ── Helpers ───────────────────────────────────────────────────────────────────

const toDateInput = (d?: Date | string | null) =>
  d ? new Date(d).toISOString().split('T')[0] : ''

const HELP: Record<string, string> = {
  'Skills': 'Technical and professional skills with proficiency level and years of experience. The AI uses these to match you against job requirements.',
  'Tools': 'Software, platforms, and apps you use regularly (e.g. Figma, Jira, VS Code). Listed separately from skills for clarity on a CV.',
  'Languages': 'Spoken languages and an optional proficiency label.',
  'Core Competencies': 'Behavioural and interpersonal strengths — leadership, communication, adaptability. Most impactful when backed by evidence in your experience bullets.',
  'Education': 'Academic qualifications, degrees, and formal training.',
  'Certifications': 'Professional certifications and credentials. Add expiry dates to flag ones due for renewal.',
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, helpText, onAdd }: { title: string; helpText: string; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 flex-1">
        {title}
      </h3>
      <SectionHelp text={helpText} />
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAdd} aria-label={`Add ${title}`}>
        <Plus size={12} />
      </Button>
    </div>
  )
}

// ── Row hover controls ────────────────────────────────────────────────────────

function RowControls({ onEdit, onDelete, label }: { onEdit: () => void; onDelete: () => void; label: string }) {
  return (
    <div className="absolute right-0 inset-y-0 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-card pl-1 rounded-r">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${label}`}>
        <Pencil size={11} />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={onDelete} aria-label={`Delete ${label}`}>
        <Trash2 size={11} />
      </Button>
    </div>
  )
}

// ── Radial gauge ─────────────────────────────────────────────────────────────

function RadialGauge({ years, totalYears }: { years: number; totalYears: number }) {
  const size = 36
  const strokeWidth = 3
  const r = 13
  const cx = 18
  const cy = 18
  const circumference = 2 * Math.PI * r

  const arcLength = circumference * 0.75
  const gapLength = circumference * 0.25

  const pct = totalYears > 0 ? Math.min(Math.max(years / totalYears, 0), 1) : 0
  const filledLength = pct * arcLength

  const l = (0.76 - pct * 0.36).toFixed(3)
  const color = `oklch(${l} 0.13 142)`

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${years} of ${totalYears} years experience`}>
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arcLength.toFixed(2)} ${gapLength.toFixed(2)}`}
        transform={`rotate(135, ${cx}, ${cy})`}
      />
      {pct > 0 && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filledLength.toFixed(2)} ${(circumference - filledLength).toFixed(2)}`}
          transform={`rotate(135, ${cx}, ${cy})`}
        />
      )}
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="8"
        fontWeight="700"
        fill="currentColor"
      >
        {years}y
      </text>
    </svg>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptySection({ noun, onAdd }: { noun: string; onAdd: () => void }) {
  return (
    <div className="py-5 text-center space-y-2">
      <p className="text-sm text-muted-foreground">No {noun} added yet.</p>
      <Button variant="outline" size="sm" onClick={onAdd}>Add your first {noun.replace(/s$/, '')}</Button>
    </div>
  )
}

// ── Skills ────────────────────────────────────────────────────────────────────

function SkillsSection({ initial, careerYears }: { initial: SkillType[]; careerYears: number }) {
  const [skills, setSkills] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SkillType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (s: SkillType) => { setEditing(s); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = skills
    setSkills(prev => prev.filter(item => item.id !== id))
    try { await deleteSkill(id) } catch { setSkills(prev) }
  }

  const handleSave = async (data: Parameters<typeof createSkill>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateSkill(editing.id, data)
        setSkills(prev => prev.map(x => x.id === editing.id ? updated as unknown as SkillType : x))
      } else {
        const created = await createSkill(data)
        setSkills(prev => [...prev, created as unknown as SkillType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Skills" helpText={HELP['Skills']} onAdd={openAdd} />
      {skills.length === 0
        ? <EmptySection noun="skills" onAdd={openAdd} />
        : (
          <div className="space-y-1">
            {skills.map(skill => (
              <div key={skill.id} className="group relative flex items-center gap-2 py-0.5">
                <span className="text-sm font-medium flex-1">{skill.name}</span>
                {skill.yearsOfExperience != null && (
                  <RadialGauge years={skill.yearsOfExperience} totalYears={careerYears} />
                )}
                <Badge variant="outline" className="text-xs shrink-0">{skill.level}</Badge>
                <RowControls label={skill.name} onEdit={() => openEdit(skill)} onDelete={() => handleDelete(skill.id)} />
              </div>
            ))}
          </div>
        )
      }
      <SkillDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function SkillDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: SkillType | null
  onSave: (data: Parameters<typeof createSkill>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const [level, setLevel] = useState(editing?.level?.toLowerCase() ?? 'intermediate')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const yoe = fd.get('yearsOfExperience') as string
    onSave({
      name: fd.get('name') as string,
      category: fd.get('category') as string,
      level,
      yearsOfExperience: yoe ? Number(yoe) : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Skill' : 'Add Skill'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="skill-name">Name</Label>
              <Input id="skill-name" name="name" defaultValue={editing?.name} required />
            </Field>
            <Field>
              <Label htmlFor="skill-category">Category</Label>
              <Input id="skill-category" name="category" placeholder="e.g. Backend, DevOps" defaultValue={editing?.category} required />
            </Field>
            <Field>
              <Label>Level</Label>
              <Select value={level} onValueChange={(v) => v && setLevel(v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['beginner', 'intermediate', 'advanced', 'expert'].map(l => (
                    <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="skill-yoe">Years of Experience</Label>
              <Input id="skill-yoe" name="yearsOfExperience" type="number" min="0" step="0.5" defaultValue={editing?.yearsOfExperience ?? ''} />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function ToolsSection({ initial }: { initial: ToolType[] }) {
  const [tools, setTools] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ToolType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (t: ToolType) => { setEditing(t); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = tools
    setTools(prev => prev.filter(item => item.id !== id))
    try { await deleteTool(id) } catch { setTools(prev) }
  }

  const handleSave = async (data: Parameters<typeof createTool>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateTool(editing.id, data)
        setTools(prev => prev.map(x => x.id === editing.id ? updated as unknown as ToolType : x))
      } else {
        const created = await createTool(data)
        setTools(prev => [...prev, created as unknown as ToolType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Tools" helpText={HELP['Tools']} onAdd={openAdd} />
      {tools.length === 0
        ? <EmptySection noun="tools" onAdd={openAdd} />
        : (
          <div className="space-y-1">
            {tools.map(tool => (
              <div key={tool.id} className="group relative flex items-center gap-2 py-0.5">
                <span className="text-sm font-medium flex-1">{tool.name}</span>
                {tool.category && <Badge variant="secondary" className="text-xs">{tool.category}</Badge>}
                <RowControls label={tool.name} onEdit={() => openEdit(tool)} onDelete={() => handleDelete(tool.id)} />
              </div>
            ))}
          </div>
        )
      }
      <ToolDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function ToolDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: ToolType | null
  onSave: (data: Parameters<typeof createTool>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const category = fd.get('category') as string
    onSave({
      name: fd.get('name') as string,
      category: category || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Tool' : 'Add Tool'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="tool-name">Name</Label>
              <Input id="tool-name" name="name" defaultValue={editing?.name} required />
            </Field>
            <Field>
              <Label htmlFor="tool-category">Category</Label>
              <Input id="tool-category" name="category" placeholder="e.g. Design, Project Management" defaultValue={editing?.category ?? ''} />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Languages ─────────────────────────────────────────────────────────────────

function LanguagesSection({ initial }: { initial: LanguageType[] }) {
  const [languages, setLanguages] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LanguageType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (l: LanguageType) => { setEditing(l); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = languages
    setLanguages(prev => prev.filter(item => item.id !== id))
    try { await deleteLanguage(id) } catch { setLanguages(prev) }
  }

  const handleSave = async (data: Parameters<typeof createLanguage>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateLanguage(editing.id, data)
        setLanguages(prev => prev.map(x => x.id === editing.id ? updated as unknown as LanguageType : x))
      } else {
        const created = await createLanguage(data)
        setLanguages(prev => [...prev, created as unknown as LanguageType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Languages" helpText={HELP['Languages']} onAdd={openAdd} />
      {languages.length === 0
        ? <EmptySection noun="languages" onAdd={openAdd} />
        : (
          <div className="space-y-1">
            {languages.map(lang => (
              <div key={lang.id} className="group relative flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm font-medium">{lang.name}</span>
                {lang.proficiency && <Badge variant="secondary" className="text-xs">{lang.proficiency}</Badge>}
                <RowControls label={lang.name} onEdit={() => openEdit(lang)} onDelete={() => handleDelete(lang.id)} />
              </div>
            ))}
          </div>
        )
      }
      <LanguageDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function LanguageDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: LanguageType | null
  onSave: (data: Parameters<typeof createLanguage>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSave({ name: fd.get('name') as string, proficiency: fd.get('proficiency') as string })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Language' : 'Add Language'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="lang-name">Language</Label>
              <Input id="lang-name" name="name" defaultValue={editing?.name} required />
            </Field>
            <Field>
              <Label htmlFor="lang-proficiency">Proficiency <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="lang-proficiency" name="proficiency" defaultValue={editing?.proficiency ?? ''} placeholder="e.g. Native, C1, Conversational" />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Core Competencies ─────────────────────────────────────────────────────────

function CompetenciesSection({ initial }: { initial: CompetencyType[] }) {
  const [competencies, setCompetencies] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CompetencyType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (c: CompetencyType) => { setEditing(c); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = competencies
    setCompetencies(prev => prev.filter(item => item.id !== id))
    try { await deleteCompetency(id) } catch { setCompetencies(prev) }
  }

  const handleSave = async (data: Parameters<typeof createCompetency>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateCompetency(editing.id, data)
        setCompetencies(prev => prev.map(x => x.id === editing.id ? updated as unknown as CompetencyType : x))
      } else {
        const created = await createCompetency(data)
        setCompetencies(prev => [...prev, created as unknown as CompetencyType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Core Competencies" helpText={HELP['Core Competencies']} onAdd={openAdd} />
      {competencies.length === 0
        ? <EmptySection noun="competencies" onAdd={openAdd} />
        : (
          <div className="space-y-1">
            {competencies.map(c => (
              <div key={c.id} className="group relative flex items-center gap-2 py-0.5">
                <span className="text-sm flex-1">{c.name}</span>
                <RowControls label={c.name} onEdit={() => openEdit(c)} onDelete={() => handleDelete(c.id)} />
              </div>
            ))}
          </div>
        )
      }
      <CompetencyDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function CompetencyDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: CompetencyType | null
  onSave: (data: Parameters<typeof createCompetency>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSave({ name: fd.get('name') as string })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Competency' : 'Add Competency'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="competency-name">Name</Label>
              <Input id="competency-name" name="name" placeholder="e.g. Leadership, Communication" defaultValue={editing?.name} required />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Education ─────────────────────────────────────────────────────────────────

function EducationSection({ initial }: { initial: EducationType[] }) {
  const [educations, setEducations] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EducationType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (e: EducationType) => { setEditing(e); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = educations
    setEducations(prev => prev.filter(item => item.id !== id))
    try { await deleteEducation(id) } catch { setEducations(prev) }
  }

  const handleSave = async (data: Parameters<typeof createEducation>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateEducation(editing.id, data)
        setEducations(prev => prev.map(x => x.id === editing.id ? updated as unknown as EducationType : x))
      } else {
        const created = await createEducation(data)
        setEducations(prev => [...prev, created as unknown as EducationType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Education" helpText={HELP['Education']} onAdd={openAdd} />
      {educations.length === 0
        ? <EmptySection noun="education" onAdd={openAdd} />
        : (
          <div className="space-y-4">
            {educations.map(edu => (
              <div key={edu.id} className="group relative space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{edu.institution}</p>
                    <p className="text-sm text-muted-foreground">
                      {edu.qualification}{edu.field ? ` · ${edu.field}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {edu.grade && <Badge variant="secondary" className="text-xs">{edu.grade}</Badge>}
                    <RowControls label={edu.institution} onEdit={() => openEdit(edu)} onDelete={() => handleDelete(edu.id)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(edu.startDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  {' – '}
                  {edu.endDate
                    ? new Date(edu.endDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                    : 'Present'}
                </p>
                <Separator className="mt-2" />
              </div>
            ))}
          </div>
        )
      }
      <EducationDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function EducationDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: EducationType | null
  onSave: (data: Parameters<typeof createEducation>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const endDateStr = fd.get('endDate') as string
    onSave({
      institution: fd.get('institution') as string,
      qualification: fd.get('qualification') as string,
      field: (fd.get('field') as string) || undefined,
      startDate: new Date(fd.get('startDate') as string),
      endDate: endDateStr ? new Date(endDateStr) : undefined,
      grade: (fd.get('grade') as string) || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Education' : 'Add Education'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="edu-institution">Institution</Label>
              <Input id="edu-institution" name="institution" defaultValue={editing?.institution} required />
            </Field>
            <Field>
              <Label htmlFor="edu-qualification">Qualification</Label>
              <Input id="edu-qualification" name="qualification" placeholder="e.g. BSc Computer Science" defaultValue={editing?.qualification} required />
            </Field>
            <Field>
              <Label htmlFor="edu-field">Field of Study</Label>
              <Input id="edu-field" name="field" defaultValue={editing?.field ?? ''} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="edu-start">Start Date</Label>
                <Input id="edu-start" name="startDate" type="date" defaultValue={toDateInput(editing?.startDate)} required />
              </Field>
              <Field>
                <Label htmlFor="edu-end">End Date</Label>
                <Input id="edu-end" name="endDate" type="date" defaultValue={toDateInput(editing?.endDate)} />
              </Field>
            </div>
            <Field>
              <Label htmlFor="edu-grade">Grade</Label>
              <Input id="edu-grade" name="grade" placeholder="e.g. First Class, 3.8 GPA" defaultValue={editing?.grade ?? ''} />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Certifications ────────────────────────────────────────────────────────────

function CertificationsSection({ initial }: { initial: CertType[] }) {
  const [certs, setCerts] = useState(initial)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CertType | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const sixMonthsFromNow = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 6)
    return d
  }, [])

  const openAdd = () => { setEditing(null); setSaveError(null); setOpen(true) }
  const openEdit = (c: CertType) => { setEditing(c); setSaveError(null); setOpen(true) }

  const handleDelete = async (id: string) => {
    const prev = certs
    setCerts(prev => prev.filter(item => item.id !== id))
    try { await deleteCertification(id) } catch { setCerts(prev) }
  }

  const handleSave = async (data: Parameters<typeof createCertification>[0]) => {
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateCertification(editing.id, data)
        setCerts(prev => prev.map(x => x.id === editing.id ? updated as unknown as CertType : x))
      } else {
        const created = await createCertification(data)
        setCerts(prev => [...prev, created as unknown as CertType])
      }
      setOpen(false)
    } catch {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Certifications" helpText={HELP['Certifications']} onAdd={openAdd} />
      {certs.length === 0
        ? <EmptySection noun="certifications" onAdd={openAdd} />
        : (
          <div className="space-y-1">
            {certs.map(cert => {
              const expiringSoon = cert.expiryDate && new Date(cert.expiryDate) < sixMonthsFromNow
              return (
                <div key={cert.id} className="group relative flex items-start justify-between gap-2 py-1.5 border-b border-border last:border-0">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-semibold truncate">{cert.name}</p>
                    {cert.issuer && <p className="text-xs text-muted-foreground">{cert.issuer}</p>}
                    <p className="text-xs text-muted-foreground">
                      {cert.issueDate && `Issued ${new Date(cert.issueDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`}
                      {cert.expiryDate && ` · Expires ${new Date(cert.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {expiringSoon && <Badge variant="warning" className="text-xs">Expires soon</Badge>}
                    <RowControls label={cert.name} onEdit={() => openEdit(cert)} onDelete={() => handleDelete(cert.id)} />
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
      <CertificationDialog key={editing?.id ?? 'new'} open={open} onOpenChange={setOpen} editing={editing} onSave={handleSave} saving={saving} saveError={saveError} />
    </div>
  )
}

function CertificationDialog({
  open, onOpenChange, editing, onSave, saving, saveError,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: CertType | null
  onSave: (data: Parameters<typeof createCertification>[0]) => void
  saving: boolean
  saveError: string | null
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const issueDateStr = fd.get('issueDate') as string
    if (!issueDateStr) return // input is required, this is a safety guard
    const expiryStr = fd.get('expiryDate') as string
    onSave({
      name: fd.get('name') as string,
      issuer: fd.get('issuer') as string,
      issueDate: new Date(issueDateStr),
      expiryDate: expiryStr ? new Date(expiryStr) : undefined,
      credentialUrl: (fd.get('credentialUrl') as string) || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Certification' : 'Add Certification'}</DialogTitle>
        </DialogHeader>
        <form key={editing?.id ?? 'new'} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <Label htmlFor="cert-name">Certification Name</Label>
              <Input id="cert-name" name="name" defaultValue={editing?.name} required />
            </Field>
            <Field>
              <Label htmlFor="cert-issuer">Issuer</Label>
              <Input id="cert-issuer" name="issuer" defaultValue={editing?.issuer ?? ''} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="cert-issued">Issue Date</Label>
                <Input id="cert-issued" name="issueDate" type="date" defaultValue={toDateInput(editing?.issueDate)} required />
              </Field>
              <Field>
                <Label htmlFor="cert-expiry">Expiry Date</Label>
                <Input id="cert-expiry" name="expiryDate" type="date" defaultValue={toDateInput(editing?.expiryDate)} />
              </Field>
            </div>
            <Field>
              <Label htmlFor="cert-url">Credential URL</Label>
              <Input id="cert-url" name="credentialUrl" type="url" placeholder="https://..." defaultValue={editing?.credentialUrl ?? ''} />
            </Field>
          </FieldGroup>
          {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary" disabled={saving}>Cancel</Button>} />
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── LeftRail ──────────────────────────────────────────────────────────────────

type LeftRailProps = {
  skills: FullProfile['skills']
  tools: FullProfile['tools']
  languages: FullProfile['languages']
  competencies: FullProfile['competencies']
  educations: FullProfile['educations']
  certifications: FullProfile['certifications']
  careerYears: number
}

export function LeftRail({ skills, tools, languages, competencies, educations, certifications, careerYears }: LeftRailProps) {
  return (
    <div className="space-y-6">
      <SkillsSection initial={skills} careerYears={careerYears} />
      <ToolsSection initial={tools} />
      <LanguagesSection initial={languages} />
      <CompetenciesSection initial={competencies} />
      <EducationSection initial={educations} />
      <CertificationsSection initial={certifications} />
    </div>
  )
}
