import { describe, expect, it } from 'vitest'
import { fillCVHeader } from './header'
import type { CVDocumentContent } from './schema'

const profile = {
  name: 'Robin Placeholder', headline: 'Program manager', location: 'Lyon',
  email: 'robin@example.test', phone: null, linkedin: 'linkedin.com/in/robin', website: null,
}

describe('fillCVHeader', () => {
  it('replaces name, location and contact, keeping the tailored headline', () => {
    const content: CVDocumentContent = {
      version: 1,
      sections: [{
        id: 'h', type: 'header', visible: true,
        data: { name: 'R. P.', headline: 'Delivery lead for logistics', location: 'Somewhere', contact: { email: 'made-up@x.test' } },
      }],
    }
    const out = fillCVHeader(content, profile)
    expect(out.sections[0]).toEqual({
      id: 'h', type: 'header', visible: true,
      data: {
        name: 'Robin Placeholder', headline: 'Delivery lead for logistics', location: 'Lyon',
        contact: { email: 'robin@example.test', phone: null, linkedin: 'linkedin.com/in/robin', website: null },
      },
    })
  })

  it('falls back to the profile headline when the model left it empty', () => {
    const content: CVDocumentContent = {
      version: 1,
      sections: [{ id: 'h', type: 'header', visible: true, data: { name: '', headline: ' ', contact: {} } }],
    }
    expect(fillCVHeader(content, profile).sections[0].data).toMatchObject({ headline: 'Program manager' })
  })

  it('adds a header at the top when the model omitted one', () => {
    const content: CVDocumentContent = {
      version: 1,
      sections: [{ id: 'p', type: 'profile', visible: true, data: { content: 'Summary' } }],
    }
    const out = fillCVHeader(content, profile)
    expect(out.sections.map((s) => s.type)).toEqual(['header', 'profile'])
  })
})
