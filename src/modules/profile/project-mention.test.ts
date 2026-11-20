import { expect, it } from 'vitest'
import { mentionedProject } from './project-mention'

it('suggests the most specific project named in the wording, including its version', () => {
  const projects = [{ name: 'Heroes' }, { name: 'Heroes 2.0' }, { name: 'Heroes 3.0' }]
  expect(mentionedProject('Grew sales from the Heroes 3.0 launch', projects)).toBe(projects[2])
  expect(mentionedProject('Grew sales from the launch', projects)).toBeUndefined()
  expect(mentionedProject('Grew sales from the Heroes 3.0 launch', [projects[1]])).toBeUndefined()
})
