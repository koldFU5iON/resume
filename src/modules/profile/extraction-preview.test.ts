import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ExtractionPanel } from '@/app/dashboard/profile/_components/ExtractionPanel'
import type { ExtractionReview } from './extraction-draft'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/profile/extract', () => ({ extractFromNotes: vi.fn(), reviewExtractionItem: vi.fn() }))

it('shows full existing and suggested outcomes separately from structured result choices', () => {
  const review: ExtractionReview = {
    version: 1, sourceVersion: 'a'.repeat(64), stale: false, archived: false, notice: null, projects: [],
    items: [{
      item: { id: 'draft', key: 'key', kind: 'achievement', source: 'parser', original: 'Saved time', description: 'I saved deployment time.',
        impact: '3 hours saved for each release', result: { measure: 'Time saved', value: '3 hours', baseline: null, period: null }, project: null, projectEdited: false },
      match: { id: 'existing', text: 'Saved deployment time', version: 'version', project: null, replaceable: true, exact: true,
        impact: '2 hours saved on every deployment, eliminating the weekend shift.', result: { measure: 'Time saved', value: '2 hours', baseline: null, period: null }, resultConflict: true },
    }],
  }
  const html = renderToStaticMarkup(createElement(ExtractionPanel, { owner: { experienceId: 'role' }, review }))
  expect(html).toContain('Existing outcome: 2 hours saved on every deployment, eliminating the weekend shift.')
  expect(html).toContain('Suggested outcome: 3 hours saved for each release')
  expect(html).toContain('Existing structured result: Time saved: 2 hours')
  expect(html).toContain('Suggested structured result: Time saved: 3 hours')
  expect(html).toContain('keep existing structured result')
  expect(html).toContain('Replacement uses the suggested outcome.')
})
