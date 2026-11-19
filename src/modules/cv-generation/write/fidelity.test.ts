import { describe, expect, it } from 'vitest'
import { negationDrift, scopeDrift } from './fidelity'

describe('negationDrift: a bullet may not add a negation its evidence does not have', () => {
  const evidence = 'Program was voluntarily adopted by the client partner team, driven entirely by demonstrated value rather than mandate.'
  it('flags the meaning flip from voluntary to "no mandate"', () => {
    expect(negationDrift('Adopted by the client partner team with no mandate to surface upsell opportunities.', evidence)).toEqual(['no'])
  })
  it('flags each token when the evidence has no negation at all, once', () => {
    expect(negationDrift('Never missed a deadline, without escalation, and not once late.', 'Delivered every release on time.')).toEqual(['never', 'without', 'not'])
  })
  it('treats all negation words as one class', () => {
    expect(negationDrift('Ran with no budget.', 'Ran with zero budget.')).toEqual([])
    expect(negationDrift('Scaled without extra headcount.', 'Scaled with no extra headcount.')).toEqual([])
    expect(negationDrift('Never missed a deadline.', 'Did not miss a deadline.')).toEqual([])
  })
  it('catches n\'t forms and cannot', () => {
    expect(negationDrift("Didn't miss a deadline.", 'Hit every deadline.')).toEqual(["didn't"])
    expect(negationDrift('Built what vendors cannot.', 'Built an in-house tool.')).toEqual(['cannot'])
    expect(negationDrift('Didn’t miss a deadline.', 'Hit every deadline.')).toEqual(['didn’t'])
  })
  it('ignores non-negating idioms', () => {
    expect(negationDrift('Not only cut cost but grew sales.', 'Cut cost and grew sales.')).toEqual([])
    expect(negationDrift('Ranked No. 1 in the region; no longer a pilot.', 'Ranked first in the region.')).toEqual([])
  })
  it('accepts a negation the evidence has, and a bullet with none', () => {
    expect(negationDrift('Shipped with no downtime.', 'Shipped the migration with no downtime.')).toEqual([])
    expect(negationDrift('Cut release time by 40%.', evidence)).toEqual([])
    expect(negationDrift('Won a deal with zero churn.', 'Account renewed with zero churn for two years.')).toEqual([])
  })
  it('does not flag a negation dropped from the bullet (only additions are checked)', () => {
    expect(negationDrift('Kept the service uninterrupted.', 'Shipped with no downtime.')).toEqual([])
  })
  it('does not read "no" inside another word', () => {
    expect(negationDrift('Led the innovation and notable growth programme.', 'Led growth.')).toEqual([])
  })
})

describe('scopeDrift: a superlative keeps its scope qualifier, or is dropped', () => {
  const evidence = ["The territory's largest single commercial order, worth 20,000+ units."]
  it('flags "Italy\'s largest" written for "the territory\'s largest"', () => {
    expect(scopeDrift("Closed Italy's largest single commercial order, 20,000+ units.", evidence)).toEqual([{ claim: 'largest', qualifier: 'territory' }])
  })
  it('accepts the bullet that keeps the qualifier, or drops the superlative', () => {
    expect(scopeDrift("Closed the territory's largest single commercial order.", evidence)).toEqual([])
    expect(scopeDrift('Closed a single commercial order of 20,000+ units.', evidence)).toEqual([])
  })
  it('covers first/only/best/record and the other qualifiers (region, at the time, in the company, ever, annual)', () => {
    expect(scopeDrift('Delivered the first launch of its kind.', ['Delivered the first launch in the company.'])).toEqual([{ claim: 'first', qualifier: 'in the company' }])
    expect(scopeDrift('Set a record result.', ['Set the regional record for sign-ups.'])).toEqual([{ claim: 'record', qualifier: 'region' }])
    expect(scopeDrift('Best annual result.', ['Best result ever in the team.'])).toEqual([{ claim: 'best', qualifier: 'ever' }])
  })
  it('does not flag a superlative with no qualifier in the evidence', () => {
    expect(scopeDrift('Ran the largest launch.', ['Ran the largest launch.'])).toEqual([])
  })
  it('keeps "at the time" and "to date" attached to a figure', () => {
    expect(scopeDrift('Grew sign-ups to 14,000.', ['Sign-ups reached 14,000 to date.'])).toEqual([{ claim: '14,000', qualifier: 'to date' }])
    expect(scopeDrift('Grew sign-ups to 14,000 to date.', ['Sign-ups reached 14,000 to date.'])).toEqual([])
    expect(scopeDrift('Grew the team.', ['Sign-ups reached 14,000 to date.'])).toEqual([])
  })
})
