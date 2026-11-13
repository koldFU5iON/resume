import { describe, expect, it } from 'vitest'
import { visibleJobIds } from './list-selection'

const groups = [
  { key: 'open', label: 'Open', jobs: [{ id: 'a' }], defaultCollapsed: false },
  { key: 'closed', label: 'Closed', jobs: [{ id: 'b' }], defaultCollapsed: true },
]

describe('visibleJobIds', () => {
  it('excludes closed groups by default and honors explicit collapse changes', () => {
    expect([...visibleJobIds(groups, {})]).toEqual(['a'])
    expect([...visibleJobIds(groups, { open: true, closed: false })]).toEqual(['b'])
  })

  it('keeps flat search results selectable regardless of stored group collapse', () => {
    expect([...visibleJobIds([{ ...groups[0], key: 'all', label: null }], { all: true })]).toEqual(['a'])
  })

  it('does not include jobs removed by the current filters or a refresh', () => {
    expect([...visibleJobIds([], { closed: false })]).toEqual([])
  })
})
