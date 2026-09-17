import { describe, expect, it } from 'vitest'
import { splitThinkingContent } from './thinking'

describe('splitThinkingContent', () => {
  it('hides completed thinking blocks while retaining the response', () => {
    expect(splitThinkingContent('<thinking>Private reasoning</thinking>Hello')).toEqual({
      content: 'Hello',
      isThinking: false,
    })
  })

  it('marks an unclosed thinking block as in progress', () => {
    expect(splitThinkingContent('Before<thinking>Working through it')).toEqual({
      content: 'Before',
      isThinking: true,
    })
  })

  it('removes multiple thinking blocks', () => {
    expect(splitThinkingContent('<thinking>One</thinking>A<thinking>Two</thinking>B')).toEqual({
      content: 'AB',
      isThinking: false,
    })
  })
})
