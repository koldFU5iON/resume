import { cn } from "@/lib/utils"
import type { DeepDiveReport } from "@/modules/deep-dive/schema"
import { formatMoney } from "@/app/dashboard/job-applications/_components/deep-dive-view"

type Band = { label: string; min: number; max: number; mark?: number; className: string }

/**
 * Pay in the ad, the market range and the suggested ask on one scale, so the
 * ask can be read against both. Only figures in one currency are drawn (the
 * ask's, else the ad's); the numbers are also written out in text beside it,
 * so the scale is decorative for screen readers.
 */
export function PayScale({ pay }: { pay: DeepDiveReport['pay'] }) {
  const currency = pay.ask?.currency ?? pay.stated?.currency ?? pay.market?.currency
  if (!currency) return null

  const bands: Band[] = []
  if (pay.stated && pay.stated.currency === currency) {
    const lo = pay.stated.min ?? pay.stated.max
    const hi = pay.stated.max ?? pay.stated.min
    if (lo !== null && hi !== null) bands.push({ label: 'In the ad', min: lo, max: hi, className: 'bg-foreground/35' })
  }
  if (pay.market && pay.market.currency === currency) {
    bands.push({ label: 'Market', min: pay.market.min, max: pay.market.max, className: 'bg-sky-500/45' })
  }
  if (pay.ask && pay.ask.currency === currency) {
    bands.push({ label: 'Your ask', min: pay.ask.floor, max: pay.ask.stretch, mark: pay.ask.target, className: 'bg-primary/45' })
  }
  if (bands.length < 2) return null

  const lo = Math.min(...bands.map((b) => b.min))
  const hi = Math.max(...bands.map((b) => b.max))
  if (!(hi > lo)) return null
  const pad = (hi - lo) * 0.08
  const start = lo - pad
  const span = hi + pad - start
  const pct = (v: number) => `${((v - start) / span) * 100}%`

  return (
    <div className="mt-6 max-w-2xl" aria-hidden="true">
      <div className="space-y-2.5">
        {bands.map((b) => (
          <div key={b.label} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
            <span className="text-xs text-muted-foreground">{b.label}</span>
            <div className="relative h-2 rounded-full bg-muted">
              <div
                className={cn("absolute inset-y-0 rounded-full", b.className, b.min === b.max && "w-1.5 -translate-x-1/2")}
                style={b.min === b.max ? { left: pct(b.min) } : { left: pct(b.min), width: `calc(${pct(b.max)} - ${pct(b.min)})` }}
              />
              {b.mark !== undefined && (
                <div
                  className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-primary"
                  style={{ left: pct(b.mark) }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
        <span />
        <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>{formatMoney(lo, currency)}</span>
          <span>{formatMoney(hi, currency)}</span>
        </div>
      </div>
    </div>
  )
}
