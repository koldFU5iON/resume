'use client'

import { useState, useTransition, useEffect, Fragment } from 'react'
import { RotateCcw, Download, MessageSquare, Loader2, RefreshCw, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageContext, useWorkspaceContext } from '@/lib/context/page-context'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { updateSection, toggleVisibility, regenerateCVContent, addCustomSection, reorderSections } from '@/modules/cv/actions'
import { runATSScore } from '@/modules/cv/ats-score-action'
import type { ATSScoreResult } from '@/modules/cv/ats-score-schema'
import { toMarkdown, toText, sectionToPlainText } from '@/modules/cv/export'
import { SectionRail } from './section-rail'
import { SectionGap } from './section-gap'
import { CvBlock } from './cv-block'
import { HeaderBlock } from './blocks/header-block'
import { ProfileBlock } from './blocks/profile-block'
import { CompetenciesBlock } from './blocks/competencies-block'
import { CapabilitiesBlock } from './blocks/capabilities-block'
import { ExperienceBlock } from './blocks/experience-block'
import { EducationBlock } from './blocks/education-block'
import { CertificationBlock } from './blocks/certification-block'
import { SkillsBlock } from './blocks/skills-block'
import { ToolsBlock } from './blocks/tools-block'
import { LanguagesBlock } from './blocks/languages-block'
import { CustomBlock } from './blocks/custom-block'
import { MarkdownProse } from '@/components/ui/markdown-prose'
import { ATSScorePanel } from './ats-score-panel'
import type { CVDocumentContent, CVSection } from '@/modules/cv/schema'
import type { JobFit } from '@/app/types/job-application'

export type CVWithMeta = {
  id: string
  status: string
  jobTitle: string | null
  company: string | null
  jobApplicationId: string | null
  jobApplication?: {
    id: string
    title: string | null
    company: string | null
    jobDescription: string | null
    jobFit?: unknown
  } | null
  profileName: string
  content: CVDocumentContent
}

type Props = { cv: CVWithMeta; stale?: boolean }

export function CvEditor({ cv, stale = false }: Props) {
  const [content, setContent] = useState<CVDocumentContent>(cv.content)
  const [, startTransition] = useTransition()
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [jobPanelOpen, setJobPanelOpen] = useState(false)
  const [atsPanelOpen, setAtsPanelOpen] = useState(false)
  const [atsResult, setAtsResult] = useState<ATSScoreResult | null>(null)
  const [atsRunning, setAtsRunning] = useState(false)

  const { openPanel } = usePageContext()
  const router = useRouter()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  useWorkspaceContext({
    type: 'cv',
    cvId: cv.id,
    title: cv.jobTitle ?? 'CV',
    company: cv.company ?? undefined,
  })

  useEffect(() => {
    function handleCvSectionUpdated(e: CustomEvent<{ sectionId: string; section: CVSection | Record<string, unknown> }>) {
      setContent(c => ({
        ...c,
        sections: c.sections.map(s =>
          s.id === e.detail.sectionId ? { ...s, data: (e.detail.section as CVSection).data ?? e.detail.section } as typeof s : s
        ),
      }))
    }
    window.addEventListener('cv-section-updated', handleCvSectionUpdated as EventListener)
    return () => window.removeEventListener('cv-section-updated', handleCvSectionUpdated as EventListener)
  }, [])

  useEffect(() => {
    function handleCvSectionCreated(e: CustomEvent<{ section: CVSection }>) {
      setContent(c => ({ ...c, sections: [...c.sections, e.detail.section] }))
    }
    window.addEventListener('cv-section-created', handleCvSectionCreated as EventListener)
    return () => window.removeEventListener('cv-section-created', handleCvSectionCreated as EventListener)
  }, [])

  const displayTitle = cv.jobTitle && cv.company
    ? `${cv.jobTitle} · ${cv.company}`
    : 'Master CV'

  // File-safe slug: Devon-Stanton-CV-Senior-PM_Acme-Corp
  const nameSlug = cv.profileName.replace(/\s+/g, '-')
  const roleSlug = cv.jobTitle ? cv.jobTitle.replace(/\s+/g, '-') : ''
  const companySlug = cv.company ? cv.company.replace(/\s+/g, '-') : ''
  const fileSlug = cv.jobTitle && cv.company
    ? `${nameSlug}-CV-${roleSlug}_${companySlug}`
    : `${nameSlug}-CV`

  function optimisticMutate(next: CVDocumentContent, serverCall: () => Promise<unknown>, errorMessage: string) {
    const prev = content
    setContent(next)
    startTransition(async () => {
      try {
        await serverCall()
      } catch {
        setContent(prev)
        toast.error(errorMessage)
      }
    })
  }

  function handleUpdateSection(section: CVSection) {
    optimisticMutate(
      { ...content, sections: content.sections.map(s => s.id === section.id ? section : s) },
      () => updateSection(cv.id, section),
      'Failed to save changes. Please try again.',
    )
  }

  function handleToggleVisibility(sectionId: string) {
    optimisticMutate(
      { ...content, sections: content.sections.map(s => s.id === sectionId ? { ...s, visible: !s.visible } : s) },
      () => toggleVisibility(cv.id, sectionId),
      'Failed to save changes. Please try again.',
    )
  }

  async function handleAddCustomSection(heading: string, subtype: 'text' | 'list', insertIndex?: number) {
    try {
      const newSection = await addCustomSection(cv.id, heading, subtype, insertIndex)
      setContent(c => {
        const idx = Math.max(0, Math.min(insertIndex ?? c.sections.length, c.sections.length))
        const sections = [...c.sections]
        sections.splice(idx, 0, newSection)
        return { ...c, sections }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add section')
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = content.sections.findIndex(s => s.id === active.id)
    const newIndex = content.sections.findIndex(s => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(content.sections, oldIndex, newIndex)
    optimisticMutate(
      { ...content, sections: reordered },
      () => reorderSections(cv.id, reordered.map(s => s.id)),
      'Failed to reorder sections. Please try again.',
    )
  }

  async function handleRunATS() {
    setAtsRunning(true)
    try {
      const res = await runATSScore(cv.id)
      if (res.ok) {
        setAtsResult(res.result)
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error('ATS check failed. Please try again.')
    } finally {
      setAtsRunning(false)
    }
  }

  function handleCopySection(section: CVSection) {
    navigator.clipboard.writeText(sectionToPlainText(section))
    toast.success('Section copied to clipboard')
  }

  function confirmRegenerate() {
    setShowConfirm(false)
    setIsRegenerating(true)
    startTransition(async () => {
      try {
        const newContent = await regenerateCVContent(cv.id)
        setContent(newContent)
        toast.success('CV regenerated successfully')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Regeneration failed')
      } finally {
        setIsRegenerating(false)
      }
    })
  }

  function downloadFile(fileContent: string, filename: string, mime: string) {
    const blob = new Blob([fileContent], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <>
      {/* Regenerate confirmation dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate CV?</DialogTitle>
            <DialogDescription>
              This will overwrite your current edits with a freshly generated version.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={confirmRegenerate}
              className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground hover:bg-destructive/90"
            >
              Regenerate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex h-full flex-col print:block print:h-auto">
        {/* Toolbar */}
        <div className="border-b border-border bg-background px-4 py-2 print:hidden">
          {/* Mobile: title on its own line to prevent squash */}
          <div className="mb-1.5 flex items-center gap-2 min-w-0 sm:hidden">
            <span className="text-sm font-semibold truncate">{displayTitle}</span>
            <Badge variant="outline" className="text-xs capitalize shrink-0">{cv.status}</Badge>
          </div>
          <div className="flex items-center justify-between">
            {/* Desktop-only title */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-sm font-semibold">{displayTitle}</span>
              <Badge variant="outline" className="text-xs capitalize">{cv.status}</Badge>
            </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={isRegenerating}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {isRegenerating
                ? <Loader2 className="size-3.5 animate-spin" />
                : <RotateCcw className="size-3.5" />
              }
              {isRegenerating ? 'Generating…' : 'Regenerate'}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExport(v => !v)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                <Download className="size-3.5" />
                Export
              </button>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} />
                  <div className="absolute right-0 top-full z-20 w-40 rounded-md border border-border bg-background py-1 shadow-md">
                    <button
                      onClick={() => { window.open(`/api/cv/${cv.id}/pdf`, '_blank'); setShowExport(false) }}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      Download PDF
                    </button>
                    <button onClick={() => { downloadFile(toMarkdown(content), `${fileSlug}.md`, 'text/markdown'); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">
                      Download Markdown
                    </button>
                    <button onClick={() => { downloadFile(toText(content), `${fileSlug}.txt`, 'text/plain'); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">
                      Download Text
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={openPanel}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              <MessageSquare className="size-3.5" />
              Discuss
            </button>
            {cv.jobApplicationId && cv.jobApplication?.jobDescription && (
              <button
                onClick={() => setJobPanelOpen(o => !o)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Job ▸
              </button>
            )}
            <button
              onClick={() => setAtsPanelOpen(o => !o)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              ATS ▸
            </button>
            <button
              onClick={() => router.refresh()}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
              title="Reload CV from server"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          </div>
        </div>

        {/* Body */}
        <div className="relative flex flex-1 overflow-hidden print:overflow-visible print:h-auto print:block">
          <div className="relative flex-1 overflow-y-auto bg-muted/30 p-0 md:p-6 print:overflow-visible print:h-auto print:bg-white print:p-0">
            {stale && !isRegenerating && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 md:mt-0 print:hidden">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Your master CV changed since this CV was tailored. Re-tailor it to pick up your latest positioning.
                </p>
                <button
                  onClick={() => setShowConfirm(true)}
                  className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
                >
                  Re-tailor
                </button>
              </div>
            )}
            {isRegenerating && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm print:hidden">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">Generating your CV…</p>
                <p className="text-xs text-muted-foreground">This takes about 15–30 seconds</p>
              </div>
            )}
            <div className="cv-document cv-print-area page-break-guides mx-auto w-full max-w-[794px] rounded-none shadow-none md:rounded-lg md:shadow-sm bg-background print:max-w-none print:shadow-none">
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext items={content.sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {content.sections.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <p className="text-sm font-medium text-muted-foreground">No content yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Click Regenerate to generate your CV, or add a section below.
                      </p>
                      <div className="mt-4 w-full">
                        <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                      {content.sections.map((section, index) => {
                        const prevVisible = content.sections.slice(0, index).filter(s => s.visible).at(-1)
                        const showHeading = prevVisible?.type !== section.type
                        return (
                          <Fragment key={section.id}>
                            <CvBlock
                              section={section}
                              onToggleVisibility={() => handleToggleVisibility(section.id)}
                              onCopy={() => handleCopySection(section)}
                            >
                              {renderBlock(section, handleUpdateSection, showHeading)}
                            </CvBlock>
                            <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, index + 1)} />
                          </Fragment>
                        )
                      })}
                    </>
                  )}
                </SortableContext>
              </DndContext>
            </div>
          </div>
          {jobPanelOpen && cv.jobApplication && (
            <div className="absolute inset-y-0 right-0 z-10 flex w-[42%] min-w-[260px] max-w-[480px] flex-col border-l bg-background overflow-y-auto p-4 print:hidden">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Job</span>
                <button
                  type="button"
                  onClick={() => setJobPanelOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close job panel"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-sm font-medium">{cv.jobApplication.title}</p>
              {cv.jobApplication.company && (
                <p className="text-xs text-muted-foreground">{cv.jobApplication.company}</p>
              )}
              {(() => {
                const fit = cv.jobApplication.jobFit as JobFit | null
                if (!fit) return null
                const gaugeColor = { reach: 'bg-blue-400', possible: 'bg-amber-300', stretch: 'bg-amber-500', solid: 'bg-orange-500', standout: 'bg-red-500' }[fit.label]
                return (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Job Fit</p>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={`absolute inset-y-0 left-0 rounded-full ${gaugeColor}`} style={{ width: `${fit.rating * 10}%` }} />
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{fit.rating}/10</span>
                    </div>
                    <p className="text-xs font-medium capitalize">{fit.label}</p>
                    {fit.justification && (
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-4">{fit.justification}</p>
                    )}
                  </div>
                )
              })()}
              {cv.jobApplication.jobDescription && (
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Job Description
                  </p>
                  <MarkdownProse content={cv.jobApplication.jobDescription} />
                </div>
              )}
              <div className="mt-auto border-t pt-3">
                <Link
                  href={`/dashboard/job-applications/view/${cv.jobApplication.id}`}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  View job →
                </Link>
              </div>
            </div>
          )}
          {atsPanelOpen && (
            <div className="absolute inset-y-0 right-0 z-10 flex w-[42%] min-w-[260px] max-w-[480px] flex-col border-l bg-background overflow-y-auto p-4 print:hidden">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">ATS Score</span>
                <button
                  type="button"
                  onClick={() => setAtsPanelOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close ATS panel"
                >
                  <X className="size-4" />
                </button>
              </div>
              <ATSScorePanel
                cvId={cv.id}
                cvTitle={cv.jobTitle ?? 'CV'}
                cvCompany={cv.company}
                hasJobDescription={!!(cv.jobApplication?.jobDescription)}
                result={atsResult}
                isPending={atsRunning}
                onRun={handleRunATS}
              />
            </div>
          )}
          <SectionRail
            sections={content.sections}
            onToggleVisibility={handleToggleVisibility}
            atsResult={atsResult}
            atsRunning={atsRunning}
            onRunATS={handleRunATS}
            onOpenATS={() => setAtsPanelOpen(true)}
            hasJobDescription={!!(cv.jobApplication?.jobDescription)}
          />
        </div>
      </div>
    </>
  )
}

function renderBlock(section: CVSection, onUpdate: (s: CVSection) => void, showHeading = true) {
  switch (section.type) {
    case 'header': return <HeaderBlock section={section} onUpdate={onUpdate} />
    case 'profile': return <ProfileBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'competencies': return <CompetenciesBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'capabilities': return <CapabilitiesBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'experience': return <ExperienceBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'education': return <EducationBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'certification': return <CertificationBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'skills': return <SkillsBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'tools': return <ToolsBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'languages': return <LanguagesBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
    case 'custom': return <CustomBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
  }
}
