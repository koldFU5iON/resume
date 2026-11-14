'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspaceContext } from '@/lib/context/page-context'
import { buildProfileSummary } from '@/lib/profile-summary'
import {
  updateExperienceNotes,
  updateProjectNotes,
  createExperience,
} from '@/modules/profile/actions'
import type { FullProfile, Project } from '@/app/types/profile'
import { NoteEditor } from './NoteEditor'
import type { SaveState } from './NoteEditor'
import { ExperienceFrontmatter } from './ExperienceFrontmatter'
import { ActivitiesTray } from './ActivitiesTray'
import { ProjectsPanel } from './ProjectsPanel'
import { ExperienceDialog } from './Experience'
import { EditExperienceDialog, DeleteExperienceDialog } from './ExperienceManageDialogs'

type ActiveContext =
  | { type: 'experience' }
  | { type: 'project'; projectId: string }

type Props = {
  profile: FullProfile
}

export function ExperienceWorkspace({ profile }: Props) {
  const router = useRouter()
  const [experiences, setExperiences] = useState(profile.experiences)
  const [allProjects, setAllProjects] = useState(profile.projects)
  const [selectedExperienceId, setSelectedExperienceId] = useState(
    profile.experiences[0]?.id ?? '',
  )
  const [activeContext, setActiveContext] = useState<ActiveContext>({ type: 'experience' })
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Tab bar scroll state
  const tabBarRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = tabBarRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    const el = tabBarRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState)
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [])

  useEffect(() => { updateScrollState() }, [experiences])

  const selectedExperience = experiences.find(e => e.id === selectedExperienceId)
  const experienceProjects = allProjects.filter(
    p => p.experienceId === selectedExperienceId,
  )
  const selectedProject =
    activeContext.type === 'project'
      ? allProjects.find(p => p.id === activeContext.projectId) ?? null
      : null

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const profileSummary = useMemo(() => buildProfileSummary(profile), [])

  useWorkspaceContext({
    type: 'profile',
    profileSummary,
    activeExperienceId: selectedExperienceId || undefined,
    activeExperienceName: selectedExperience
      ? `${selectedExperience.role} at ${selectedExperience.company}`
      : undefined,
  })

  function selectExperience(id: string) {
    setSelectedExperienceId(id)
    setActiveContext({ type: 'experience' })
    setSaveState('idle')
  }

  function selectProject(projectId: string) {
    setActiveContext({ type: 'project', projectId })
    setSaveState('idle')
  }

  async function handleAddExperience(data: Parameters<typeof createExperience>[0]) {
    setAddOpen(false)
    const created = await createExperience(data)
    const normalized = {
      ...created,
      tags: [] as string[],
      activities: [] as typeof profile.experiences[0]['activities'],
    }
    setExperiences(prev => [normalized, ...prev])
    selectExperience(created.id)
    router.refresh()
  }

  function handleProjectCreated(project: Project) {
    setAllProjects(prev => [...prev, project])
    router.refresh()
  }

  function handleProjectDeleted(projectId: string) {
    setAllProjects(prev => prev.filter(p => p.id !== projectId))
    if (activeContext.type === 'project' && activeContext.projectId === projectId) {
      setActiveContext({ type: 'experience' })
    }
    router.refresh()
  }

  function handleExperienceDeleted(projects: 'keep' | 'delete') {
    setAllProjects(prev => projects === 'delete'
      ? prev.filter(p => p.experienceId !== selectedExperienceId)
      : prev.map(p => (p.experienceId === selectedExperienceId ? { ...p, experienceId: null } : p)))
    const remaining = experiences.filter(e => e.id !== selectedExperienceId)
    setExperiences(remaining)
    setDeleteOpen(false)
    selectExperience(remaining[0]?.id ?? '')
    router.refresh()
  }

  function handleExperienceUpdated(data: {
    company: string
    role: string
    location?: string
    remote: boolean
    startDate: Date
    endDate?: Date
  }) {
    setExperiences(prev =>
      prev.map(e => (e.id === selectedExperienceId ? { ...e, ...data } : e)),
    )
    router.refresh()
  }

  const noteKey =
    selectedExperienceId +
    '-' +
    (activeContext.type === 'project' ? activeContext.projectId : 'exp')

  const noteContent =
    activeContext.type === 'project'
      ? (selectedProject?.notes ?? '')
      : (selectedExperience?.summary ?? '')

  const noteSave =
    activeContext.type === 'project'
      ? (content: string) => updateProjectNotes(activeContext.projectId, content)
      : (content: string) => updateExperienceNotes(selectedExperienceId, content)

  const notePlaceholder =
    activeContext.type === 'project'
      ? 'Click to start writing about this project…'
      : 'Click to start writing about this role…'

  if (experiences.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border">
        <p className="text-sm text-muted-foreground">No experience added yet.</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={13} className="mr-1" /> Add Experience
        </Button>
        {addOpen && (
          <ExperienceDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onSave={handleAddExperience}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border">
      {/* Tab bar */}
      <div className="flex shrink-0 items-stretch border-b bg-muted/50">
        {/* Left scroll arrow */}
        <button
          type="button"
          onClick={() => tabBarRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
          className={cn(
            'shrink-0 border-r px-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
            !canScrollLeft && 'pointer-events-none opacity-0',
          )}
          aria-label="Scroll tabs left"
          tabIndex={canScrollLeft ? 0 : -1}
        >
          <ChevronLeft size={13} />
        </button>

        {/* Scrollable tabs */}
        <div
          ref={tabBarRef}
          className="flex min-w-0 flex-1 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {experiences.map(exp => (
            <button
              key={exp.id}
              type="button"
              onClick={() => selectExperience(exp.id)}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-xs transition-colors',
                exp.id === selectedExperienceId
                  ? '-mb-px border-primary bg-background font-semibold text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {exp.company} · {new Date(exp.startDate).getFullYear()}
            </button>
          ))}
        </div>

        {/* Right scroll arrow */}
        <button
          type="button"
          onClick={() => tabBarRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
          className={cn(
            'shrink-0 border-l px-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
            !canScrollRight && 'pointer-events-none opacity-0',
          )}
          aria-label="Scroll tabs right"
          tabIndex={canScrollRight ? 0 : -1}
        >
          <ChevronRight size={13} />
        </button>

        <div className="w-px shrink-0 bg-border" />

        {/* Add button — always visible */}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="shrink-0 whitespace-nowrap px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          + Add
        </button>
      </div>

      {/* Frontmatter */}
      {selectedExperience && (
        <ExperienceFrontmatter
          experience={selectedExperience}
          saveState={saveState}
          projectName={selectedProject?.name}
          onBack={() => setActiveContext({ type: 'experience' })}
          onEditClick={() => setEditOpen(true)}
          onDeleteClick={() => setDeleteOpen(true)}
          onFieldSaved={(field, value) => {
            setExperiences(prev =>
              prev.map(e => e.id === selectedExperienceId ? { ...e, [field]: value } : e)
            )
          }}
        />
      )}

      {/* Main body: note editor + projects panel */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Note + activities column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <NoteEditor
            key={noteKey}
            initialContent={noteContent}
            onSave={noteSave}
            onSaveStateChange={setSaveState}
            placeholder={notePlaceholder}
            className="flex-1"
          />
          {selectedExperience && activeContext.type === 'experience' && (
            <ActivitiesTray
              experienceId={selectedExperienceId}
              initialActivities={selectedExperience.activities}
            />
          )}
        </div>

        {/* Projects panel */}
        {selectedExperience && (
          <ProjectsPanel
            experienceId={selectedExperienceId}
            projects={experienceProjects}
            selectedProjectId={
              activeContext.type === 'project' ? activeContext.projectId : null
            }
            onSelect={selectProject}
            onProjectCreated={handleProjectCreated}
            onProjectDeleted={handleProjectDeleted}
          />
        )}
      </div>

      {addOpen && (
        <ExperienceDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSave={handleAddExperience}
        />
      )}

      {selectedExperience && editOpen && (
        <EditExperienceDialog
          experience={selectedExperience}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={handleExperienceUpdated}
        />
      )}

      {selectedExperience && deleteOpen && (
        <DeleteExperienceDialog
          experience={selectedExperience}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={handleExperienceDeleted}
        />
      )}
    </div>
  )
}
