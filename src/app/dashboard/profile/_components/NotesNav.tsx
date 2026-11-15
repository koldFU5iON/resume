'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createExperience, createProject } from '@/modules/profile/actions'
import { capabilitiesHref, credentialsHref, noteHref, overviewHref, type NoteIndex } from '@/modules/profile/note-index'
import { ExperienceDialog } from './Experience'

/**
 * The profile's notes: Overview, roles with their projects nested, projects
 * with no role, and the Records. Every entry is a real link. Arrow keys move
 * between visible controls; Tab reaches each link and disclosure, Home and End jump to the ends.
 */
export function NotesNav({ index, profileId }: { index: NoteIndex; profileId: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const navRef = useRef<HTMLElement>(null)
  // Open for one address only: picking a note closes the list, so the document shows.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const [addingRole, setAddingRole] = useState(false)
  const [addingProjectFor, setAddingProjectFor] = useState<string | 'standalone' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const storageKey = `profile-notes-expanded:${profileId}`
  const projectParent = index.experiences.find(experience => experience.projects.some(project => pathname === noteHref(project.id)))?.id

  useEffect(() => {
    let saved: Record<string, boolean> = {}
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        saved = Object.fromEntries(Object.entries(value).filter(([, open]) => typeof open === 'boolean'))
      }
    } catch { /* Storage can be unavailable; navigation still works. */ }
    if (projectParent) saved[projectParent] = true
    // Restore browser preferences after hydration, and reveal a directly opened project's parent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(saved)
    try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch {}
  }, [storageKey, pathname, projectParent])

  function toggleBranch(id: string) {
    setExpanded(previous => {
      const next = { ...previous, [id]: !(previous[id] ?? (projectParent === id)) }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function links(): HTMLElement[] {
    return Array.from(navRef.current?.querySelectorAll<HTMLElement>('a[data-note-link], button[data-disclosure]') ?? []).filter(control => !control.closest('[hidden]'))
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'Escape' && event.target instanceof HTMLElement) {
      const group = event.target.closest<HTMLElement>('[id^="projects-"]')
      const button = group && navRef.current?.querySelector<HTMLButtonElement>(`button[aria-controls="${group.id}"]`)
      if (button) {
        event.preventDefault()
        button.click()
        button.focus()
        return
      }
    }
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
        // Tapping the note you are already on does not change the address, so close the list here too.
        onClick={() => setOpenAt(null)}
        className={cn(
          'flex min-h-8 items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-sm leading-snug outline-none max-[1099px]:min-h-11 max-[1099px]:items-center',
          'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          nested && 'text-[13px]',
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
          className="h-8 text-sm max-[1099px]:h-11"
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
        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[1099px]:min-h-11"
      >
        <Plus size={13} aria-hidden="true" />
        {label}
      </button>
    )
  }

  const heading = 'px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70'

  return (
    <div data-notes-open={open} className="shrink-0 border-b min-[1100px]:min-h-0 min-[1100px]:w-64 min-[1100px]:border-b-0 min-[1100px]:border-r">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-notes"
        onClick={() => setOpenAt(open ? null : pathname)}
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
        className={cn('flex-col min-[1100px]:flex min-[1100px]:h-full min-[1100px]:min-h-0', open ? 'flex' : 'hidden')}
      >
        <div className="shrink-0 border-b px-2 py-2">{noteLink(overviewHref(), 'Overview')}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <h2 className={heading}>Experience</h2>
          {index.experiences.map(experience => {
            const href = noteHref(experience.id)
            const active = pathname === href || experience.projects.some(project => pathname === noteHref(project.id))
            const branchOpen = expanded[experience.id] ?? (projectParent === experience.id)
            return (
              <div key={experience.id} className="py-0.5">
                <div className="flex items-start gap-0.5">
                  {experience.projects.length > 0 ? (
                    <button
                      type="button"
                      data-disclosure=""
                      aria-label={`${branchOpen ? 'Hide' : 'Show'} projects for ${experience.title}`}
                      aria-expanded={branchOpen}
                      aria-controls={`projects-${experience.id}`}
                      onClick={() => toggleBranch(experience.id)}
                      className="flex min-h-11 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[1099px]:w-11"
                    >
                      <ChevronRight size={14} aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', branchOpen && 'rotate-90')} />
                    </button>
                  ) : <span className="w-8 shrink-0 max-[1099px]:w-11" />}
                  <div className="min-w-0 flex-1">
                    {noteLink(href, <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium text-foreground">{experience.role}</span>
                      <span className="mt-0.5 block break-words text-xs text-muted-foreground">{experience.company}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs font-normal tabular-nums text-muted-foreground">
                        <span>{experience.period}</span>
                        {experience.projects.length > 0 && <span>{experience.projects.length} {experience.projects.length === 1 ? 'project' : 'projects'}</span>}
                      </span>
                    </span>)}
                  </div>
                </div>
                <div id={`projects-${experience.id}`} hidden={!branchOpen} className="mb-2 ml-4 border-l pl-4 max-[1099px]:ml-5 max-[1099px]:pl-5">
                  {experience.projects.map(project => noteLink(noteHref(project.id), <span className="min-w-0 break-words">{project.name}</span>, true))}
                  {addingProjectFor === experience.id
                    ? projectInput(experience.id)
                    : addButton('Add project', () => { setProjectName(''); setAddingProjectFor(experience.id) })}
                </div>
                {active && experience.projects.length === 0 && <div className="ml-8 max-[1099px]:ml-11">
                  {addingProjectFor === experience.id ? projectInput(experience.id) : addButton('Add project', () => { setProjectName(''); setAddingProjectFor(experience.id) })}
                </div>}
              </div>
            )
          })}
          {addButton('Add experience', () => setAddingRole(true))}

          <h2 className={heading}>Independent projects</h2>
          {index.projects.map(project => noteLink(noteHref(project.id), <span className="min-w-0 break-words">{project.name}</span>))}
          {addingProjectFor === 'standalone'
            ? projectInput('standalone')
            : addButton('Add project', () => { setProjectName(''); setAddingProjectFor('standalone') })}

        </div>
        <div className="shrink-0 border-t px-2 pb-3">
          <h2 className={heading}>Records</h2>
          {noteLink(capabilitiesHref(), 'Capabilities')}
          {noteLink(credentialsHref(), 'Credentials')}
        </div>
      </nav>

      {addingRole && <ExperienceDialog open={addingRole} onOpenChange={setAddingRole} onSave={addRole} />}
    </div>
  )
}
