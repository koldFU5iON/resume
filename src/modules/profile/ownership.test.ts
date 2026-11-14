import { expect, it } from 'vitest'
import { activityOwnedBy } from './ownership'

it('matches evidence owned through a role or a project of the profile', () => {
  expect(activityOwnedBy('p1')).toEqual({ OR: [{ experience: { profileId: 'p1' } }, { project: { profileId: 'p1' } }] })
})
