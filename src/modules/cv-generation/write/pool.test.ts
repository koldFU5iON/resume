import { describe, expect, it } from 'vitest'
import { runPool } from './pool'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runPool', () => {
  it('never runs more than the limit at once, and returns results in item order', async () => {
    let active = 0
    let peak = 0
    const results = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await sleep(5)
      active--
      return n * 2
    })
    expect(peak).toBe(3)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([2, 4, 6, 8, 10, 12, 14])
  })

  it('starts nothing new after a failure, and reports the failure and the skipped items', async () => {
    const started: number[] = []
    const results = await runPool([1, 2, 3, 4, 5], 1, async (n) => {
      started.push(n)
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(started).toEqual([1, 2])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'skipped', 'skipped', 'skipped'])
  })

  it('handles no items', async () => {
    expect(await runPool([], 3, async () => 1)).toEqual([])
  })
})
