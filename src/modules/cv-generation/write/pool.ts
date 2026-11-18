/** A bounded-concurrency runner for the wave-1 writers. Generic and pure: no DB, no model. */

export type PoolResult<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: unknown }
  /** Never started: an earlier task failed, so no new one is launched. */
  | { status: 'skipped' }

/**
 * Runs `fn` over `items` with at most `limit` in flight, starting them in
 * order. After the first failure no further item is started (the ones already
 * running finish), so a failed run does not spend more calls. Results are in
 * item order.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = items.map(() => ({ status: 'skipped' as const }))
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        failed = true
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
