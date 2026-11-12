import {
  Binoculars,
  ClipboardList,
  Compass,
  FileText,
  HomeIcon,
  Mail,
  MessageSquare,
  NotebookPen,
  Target,
  UserRound,
  type LucideIcon
} from "lucide-react"

export type NavItem = {
  destination: string
  label: string
  Icon: LucideIcon
  /** A legacy editor being replaced by Writing Desk documents: marked "Deprecating soon" (#379). */
  deprecated?: true
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Career',
    items: [
      { destination: '/dashboard', label: 'Home', Icon: HomeIcon },
      { destination: '/dashboard/profile', label: 'Professional Profile', Icon: UserRound },
      { destination: '/dashboard/search-context', label: 'Search Context', Icon: Compass },
      { destination: '/dashboard/career-vertical', label: 'Career Vertical', Icon: Target },
    ],
  },
  {
    label: 'Job Hunt',
    items: [
      { destination: '/dashboard/job-hunt', label: 'Discover Jobs', Icon: Binoculars },
      { destination: '/dashboard/job-applications', label: 'Applications', Icon: ClipboardList },
    ],
  },
  {
    label: 'Application Tools',
    items: [
      { destination: '/dashboard/cv-builder', label: 'CV Builder', Icon: FileText, deprecated: true },
      { destination: '/dashboard/cover-letters', label: 'Cover Letters', Icon: Mail, deprecated: true },
      { destination: '/dashboard/writing-desk', label: 'Writing Desk', Icon: NotebookPen },
      { destination: '/dashboard/interview-prep', label: 'Interview Prep', Icon: MessageSquare, deprecated: true },
    ],
  },
]

// Backwards-compatibility export — other files import mainNav and we don't want to break them
export const mainNav = navGroups.flatMap(g => g.items)
