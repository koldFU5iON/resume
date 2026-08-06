import Link from 'next/link'
import { BarChart2, ChevronRight, FileText, KeyRound, LayoutGrid, PenLine, ScrollText, Sparkles, UserCircle } from 'lucide-react'
import { ContentContainer } from '@/app/components/ContentContainer'
import { Card } from '@/components/ui/card'

// Settings index. Future sections (account, notifications) can slot in
// alongside API tokens and LLM.
const SECTIONS = [
  {
    href: '/dashboard/settings/account',
    Icon: UserCircle,
    title: 'Account',
    description: 'Display name, password, and connected sign-in methods.',
  },
  {
    href: '/dashboard/settings/llm',
    Icon: Sparkles,
    title: 'LLM',
    description: 'Bring-your-own-key AI: connect Anthropic, OpenAI, or Google.',
  },
  {
    href: '/dashboard/settings/ai-writing',
    Icon: PenLine,
    title: 'AI Writing',
    description: 'Writing brief and style rules applied to all AI-generated content.',
  },
  {
    href: '/dashboard/settings/prompts',
    Icon: ScrollText,
    title: 'Prompts',
    description: 'View and customise the AI prompts behind each feature.',
  },
  {
    href: '/dashboard/settings/cv-generation',
    Icon: FileText,
    title: 'CV Generation',
    description: 'Control how the AI structures and formats your generated CVs.',
  },
  {
    href: '/dashboard/settings/job-boards',
    Icon: LayoutGrid,
    title: 'Job Board Sources',
    description: 'API keys for paid job board integrations (JSearch, Adzuna).',
  },
  {
    href: '/dashboard/settings/api-tokens',
    Icon: KeyRound,
    title: 'API tokens',
    description: 'Bearer tokens for posting jobs from agents and scripts.',
  },
  {
    href: '/dashboard/settings/usage',
    Icon: BarChart2,
    title: 'AI Usage',
    description: 'Token consumption log across all AI features.',
  },
]

export default function Page() {
  return (
    <ContentContainer
      title="Settings"
      description="Manage your AI setup, writing preferences, and external integrations."
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map(s => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            >
              <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:bg-muted/30">
                <s.Icon size={18} className="mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-0.5 shrink-0" aria-hidden="true" />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </ContentContainer>
  )
}
