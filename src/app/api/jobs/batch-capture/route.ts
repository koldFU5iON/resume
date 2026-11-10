import { type NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/session'
import { captureJobFromUrl } from '@/modules/jobs/capture'

// after() work (the early job assessment drain) runs within this limit; keep
// in sync with ROUTE_MAX_DURATION_S in src/modules/job-assessment/queue.ts.
export const maxDuration = 300

const CONCURRENCY = 3

function makeSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return function throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++
        try { resolve(await fn()) } catch (e) { reject(e) } finally {
          active--
          queue.shift()?.()
        }
      }
      if (active < limit) run()
      else queue.push(run)
    })
  }
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now()
  let profileId: string
  try {
    const { profile } = await requireProfile()
    profileId = profile.id
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rawUrls: unknown = body?.urls
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return NextResponse.json({ error: 'urls array required' }, { status: 400 })
  }

  const urls = rawUrls
    .filter((u): u is string => typeof u === 'string')
    .slice(0, 50)

  const encoder = new TextEncoder()
  const throttle = makeSemaphore(CONCURRENCY)

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let added = 0, existing = 0, failed = 0

      await Promise.all(
        urls.map((url, index) =>
          throttle(async () => {
            emit({ index, url, status: 'processing' })
            try {
              const result = await captureJobFromUrl(profileId, { url, dedupeStrategy: 'return_existing' }, { requestStartedAt })
              if (result.ok) {
                if (result.created) added++; else existing++
                emit({ index, url, status: 'success', job: result.job, created: result.created })
              } else {
                failed++
                emit({ index, url, status: 'failed', error: result.error })
              }
            } catch (e) {
              failed++
              emit({ index, url, status: 'failed', error: e instanceof Error ? e.message : 'Unexpected error' })
            }
          })
        )
      )

      emit({ type: 'done', added, existing, failed })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
