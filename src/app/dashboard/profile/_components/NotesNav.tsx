'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createExperience, createProject } from '@/modules/profile/actions'
import { capabilitiesHref, credentialsHref, noteHref, overviewHref, type NoteIndex } from '@/modules/profile/note-index'
import { ExperienceDialog } from './Experience'

/**
 * The profile's notes: Overview, roles with their projects nested, projects
 * with no role, and the Records. Every entry is a real link. Arrow keys move
 * between them (one tab stop, Enter opens), Home and End jump to the ends.
 */
export function NotesNav({ index }: { index: NoteIndex }) {
  const pathname = usePathname()
  const router = useRouter()
  const navRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [addingRole, setAddingRole] = useState(false)
  const [addingProjectFor, setAddingProjectFor] = useState<string | 'standalone' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [focused, setFocused] = useState<string | null>(null)

  // The open note is the one tab stop; before anything has focus, that is it.
  const tabStop = focused ?? pathname

  function links(): HTMLAnchorElement[] {
    return Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-note-link]') ?? [])
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLInputElement) return
    const all = links()
    const at = all.findIndex(link => link === document.activeElement)
    if (at === -1) return
    const target =
      event.key === 'ArrowDown' ? all[Math.min(at + 1, all.length - 1)]
      : event.key === 'ArrowUp' ? all[Math.max(at - 1, 0)]
      : event.key === 'Home' ? all[0]
      : event.key === 'End' ? all[all.length - 1]
      : null
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  async function addProject(parent: string | 'standalone') {
    const name = projectName.trim()
    if (!name) return
    try {
      const created = await createProject({ name, description: '', ...(parent === 'standalone' ? {} : { experienceId: parent }) })
      setAddingProjectFor(null)
      setProjectName('')
      router.push(noteHref(created.id))
    } catch {
      toast.error('Failed to create the project. Please try again.')
    }
  }

  async function addRole(data: Parameters<typeof createExperience>[0]) {
    setAddingRole(false)
    try {
      const created = await createExperience(data)
      router.push(noteHref(created.id))
    } catch {
      toast.error('Failed to add the experience. Please try again.')
    }
  }

  function noteLink(href: string, children: React.ReactNode, nested = false) {
    const current = pathname === href
    return (
      <Link
        key={href}
        href={href}
        data-note-link=""
        aria-current={current ? 'page' : undefined}
        tabIndex={tabStop === href ? 0 : -1}
        onFocus={() => setFocused(href)}
        className={cn(
          'flex min-h-8 items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm leading-snug outline-none',
          'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          nested && 'ml-4 text-[13px]',
          current ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
      </Link>
    )
  }

  function projectInput(parent: string | 'standalone') {
    return (
      <form
        key={`new-project-${parent}`}
        className={cn('px-2 py-1', parent !== 'standalone' && 'ml-4')}
        onSubmit={event => { event.preventDefault(); void addProject(parent) }}
      >
        <Input
          autoFocus
          aria-label="Project name"
          value={projectName}
          onChange={event => setProjectName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') { setAddingProjectFor(null); setProjectName('') } }}
          placeholder="Project name, then Enter"
          className="h-8 text-sm"
        />
      </form>
    )
  }

  function addButton(label: string, onClick: () => void) {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={13} aria-hidden="true" />
        {label}
      </button>
    )
  }

  const heading = 'px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70'

  return (
    <div className="shrink-0 border-b min-[1100px]:min-h-0 min-[1100px]:w-64 min-[1100px]:overflow-y-auto min-[1100px]:border-b-0 min-[1100px]:border-r">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-notes"
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 w-full items-center justify-between px-4 text-sm font-medium min-[1100px]:hidden"
      >
        Notes
        <ChevronDown size={14} aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      <nav
        id="profile-notes"
        ref={navRef}
        aria-label="Profile notes"
        onKeyDown={onKeyDown}
        className={cn('px-2 pb-4', open ? 'block' : 'hidden', 'min-[1100px]:block min-[1100px]:pt-2')}
      >
        {noteLink(overviewHref(), 'Overview')}

        <h2 className={heading}>Experience</h2>
        {index.experiences.map(experience => {
          const href = noteHref(experience.id)
          const active = pathname === href || experience.projects.some(project => pathname === noteHref(project.id))
          return (
            <div key={experience.id}>
              {noteLink(href, <>
                <span className="min-w-0 break-words">{experience.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{experience.period}</span>
              </>)}
              {experience.projects.map(project => noteLink(noteHref(project.id), <span className="min-w-0 break-words">{project.name}</span>, true))}
              {active && (addingProjectFor === experience.id
                ? projectInput(experience.id)
                : <div className="ml-4">{addButton('Add project', () => { setProjectName(''); setAddingProjectFor(experience.id) })}</div>)}
            </div>
          )
        })}
        {addButton('Add experience', () => setAddingRole(true))}

        <h2 className={heading}>Projects</h2>
        {index.projects.map(project => noteLink(noteHref(project.id), <span className="min-w-0 break-words">{project.name}</span>))}
        {addingProjectFor === 'standalone'
          ? projectInput('standalone')
          : addButton('Add project', () => { setProjectName(''); setAddingProjectFor('standalone') })}

        <h2 className={heading}>Records</h2>
        {noteLink(capabilitiesHref(), 'Capabilities')}
        {noteLink(credentialsHref(), 'Credentials')}
      </nav>

      {addingRole && <ExperienceDialog open={addingRole} onOpenChange={setAddingRole} onSave={addRole} />}
    </div>
  )
}
