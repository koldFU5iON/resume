import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PROMPT_REGISTRY } from './registry'

const promptsDir = path.join(process.cwd(), 'src/lib/prompts')

describe('PROMPT_REGISTRY', () => {
  it('has unique keys and filenames', () => {
    const keys = PROMPT_REGISTRY.map(p => p.key)
    const filenames = PROMPT_REGISTRY.map(p => p.filename)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(filenames).size).toBe(filenames.length)
  })

  it('every filename exists on disk', () => {
    for (const def of PROMPT_REGISTRY) {
      expect(existsSync(path.join(promptsDir, def.filename)), def.filename).toBe(true)
    }
  })

  it('requiredMarkers are referenced in the default file text', () => {
    for (const def of PROMPT_REGISTRY) {
      if (!def.requiredMarkers?.length) continue
      const text = readFileSync(path.join(promptsDir, def.filename), 'utf-8')
      for (const marker of def.requiredMarkers) {
        expect(text, `${def.key} should reference ${marker}`).toContain(marker)
      }
    }
  })
})
