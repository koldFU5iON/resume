import { describe, it, expect } from 'vitest'
import { ATSContextSchema } from './ats-context-schema'
import { formatATSContext } from './ats-context'

describe('ATSContextSchema', () => {
  it('parses a valid result with all three buckets', () => {
    const result = ATSContextSchema.parse({
      supported: [{ term: 'Salesforce', category: 'tool', profileEvidence: 'Salesforce (skill, expert)' }],
      adjacent: [{ term: 'HubSpot', category: 'tool', profileEvidence: 'Strong CRM background' }],
      absent: ['SAP'],
    })
    expect(result.supported[0].term).toBe('Salesforce')
    expect(result.adjacent[0].term).toBe('HubSpot')
    expect(result.absent[0]).toBe('SAP')
  })

  it('accepts null profileEvidence', () => {
    const result = ATSContextSchema.parse({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(result.supported[0].profileEvidence).toBeNull()
  })

  it('accepts empty arrays in all buckets', () => {
    const result = ATSContextSchema.parse({ supported: [], adjacent: [], absent: [] })
    expect(result.supported).toHaveLength(0)
    expect(result.adjacent).toHaveLength(0)
    expect(result.absent).toHaveLength(0)
  })

  it('rejects unknown category values', () => {
    expect(() =>
      ATSContextSchema.parse({
        supported: [{ term: 'X', category: 'unknown', profileEvidence: null }],
        adjacent: [],
        absent: [],
      }),
    ).toThrow()
  })
})

describe('formatATSContext', () => {
  it('always includes the ATS KEYWORD UPLIFT header', () => {
    const output = formatATSContext({ supported: [], adjacent: [], absent: [] })
    expect(output).toContain('== ATS KEYWORD UPLIFT ==')
  })

  it('lists supported terms with category and evidence', () => {
    const output = formatATSContext({
      supported: [{ term: 'Salesforce', category: 'tool', profileEvidence: 'CRM expert, 4y' }],
      adjacent: [],
      absent: [],
    })
    expect(output).toContain('SUPPORTED')
    expect(output).toContain('- Salesforce [tool] — CRM expert, 4y')
  })

  it('lists adjacent terms with evidence', () => {
    const output = formatATSContext({
      supported: [],
      adjacent: [{ term: 'HubSpot', category: 'tool', profileEvidence: 'Strong CRM background via Salesforce' }],
      absent: [],
    })
    expect(output).toContain('ADJACENT')
    expect(output).toContain('- HubSpot [tool] — Strong CRM background via Salesforce')
  })

  it('omits SUPPORTED section when supported is empty', () => {
    const output = formatATSContext({ supported: [], adjacent: [], absent: ['SAP'] })
    expect(output).not.toContain('SUPPORTED (use these exact terms):')
  })

  it('omits ADJACENT section when adjacent is empty', () => {
    const output = formatATSContext({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(output).not.toContain('ADJACENT (use with care):')
  })

  it('shows preamble instructions when only supported is non-empty', () => {
    const output = formatATSContext({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(output).toContain('Weave SUPPORTED terms')
    expect(output).toContain('Never use ABSENT terms')
  })

  it('handles null profileEvidence without printing "null"', () => {
    const output = formatATSContext({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(output).toContain('- Agile [methodology]')
    expect(output).not.toContain('null')
  })

  it('never mentions the absent list in the output', () => {
    const output = formatATSContext({
      supported: [],
      adjacent: [],
      absent: ['SAP', 'Oracle'],
    })
    expect(output).not.toContain('SAP')
    expect(output).not.toContain('Oracle')
  })
})
