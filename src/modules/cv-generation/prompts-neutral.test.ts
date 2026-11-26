import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The pipeline works for any user: no prompt may carry a name from one person's profile as an example. */
const DENYLIST = ['unity', 'blizzard', 'megarom', 'canonical', 'devon', 'stanton', 'weta', 'enemies', 'workato', 'hubspot', 'vega']
const DIR = join(process.cwd(), 'src/lib/prompts')

describe('cv-gen and cl-gen prompts are neutral', () => {
  const files = readdirSync(DIR).filter((f) => /^(cv|cl)-gen-.*\.md$/.test(f))

  it('finds the cv-gen and cl-gen prompts', () => {
    expect(files.filter((f) => f.startsWith('cv-gen-')).length).toBeGreaterThanOrEqual(6)
    expect(files.filter((f) => f.startsWith('cl-gen-')).length).toBe(3)
  })

  for (const f of files) {
    it(`${f} names nothing from a real profile`, () => {
      const text = readFileSync(join(DIR, f), 'utf8').toLowerCase()
      const hits = DENYLIST.filter((t) => new RegExp(`\\b${t}`).test(text))
      expect(hits).toEqual([])
    })
  }
})
