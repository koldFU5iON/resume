import { useId } from "react"
import { cn } from "@/lib/utils"

export function CurrntIcon({
  size = 24,
  className,
}: {
  size?: number
  className?: string
}) {
  // Unique per instance: with a shared id, an icon inside a hidden element
  // (e.g. the phone top bar on desktop) would blank out the visible ones.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const gradientId = `currnt-g-${uid}`
  const glowId = `currnt-glow-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6DCDD8" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="blur" />
          <feFlood floodColor="#4FB3BF" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        filter={`url(#${glowId})`}
        d="m49.9 10.6c-2.1-4.1-7.4-11.7-17.2-7.2-6.1 2.8-9.5 4.4-9.5 4.4l-8.8 3.8c-2.5 1.2-7.9-0.5-11-1.6-0.9-0.3-1.7 0.6-1.3 1.5 2.1 4.1 7.4 11.7 17.2 7.2 6.1-2.8 18.3-8.1 18.3-8.1 2.5-1.2 7.9 0.5 11 1.6 0.9 0.2 1.7-0.7 1.3-1.6z m-21.1 12.8c-1.1 0.6-5.5 2.6-5.5 2.6l-4.4 1.9c-2.2 1.2-6.9-0.4-9.7-1.5-0.8-0.4-1.5 0.6-1.1 1.4 1.8 4 6.5 11.2 15.1 6.8 5.4-2.7 9.9-4.5 9.9-4.5 2.2-1.2 6.9 0.4 9.7 1.5 0.8 0.3 1.5-0.6 1.1-1.5-1.8-3.9-6.5-11.1-15.1-6.7z m-3.2 17.7c-0.9 0.5-2.4 1.4-2.4 1.4-1.7 1.1-5.2-0.3-7.3-1.3-0.6-0.3-1.1 0.6-0.8 1.4 1.3 3.6 4.8 10.1 11.3 6.1 2.4-1.5 2.4-1.4 2.4-1.4 1.8-0.9 5.2 0.3 7.3 1.3 0.6 0.3 1.1-0.6 0.8-1.4-1.3-3.6-4.6-9.8-11.3-6.1z"
      />
    </svg>
  )
}
