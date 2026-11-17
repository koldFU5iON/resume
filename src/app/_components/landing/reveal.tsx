'use client'

import { useEffect } from 'react'

// Scroll reveal ("float in") for the landing page. Content is visible on the server
// render; this only hides and animates it once JS runs, and skips entirely for
// reduced motion. Each element floats in once, the first time it enters the viewport.
// [selector, variant, stagger siblings?]
const GROUPS: [string, '' | 'shot', boolean][] = [
  ['.hero-text > *', '', true],
  ['.hero-shot', 'shot', false],
  ['.sec-head', '', false],
  ['.steps > .step', '', true],
  ['.feat > .feat-text', '', false],
  ['.feat > :not(.feat-text)', 'shot', false],
  ['.also > *', '', true],
  ['.agent-grid > *', '', true],
  ['.cost > .card', '', true],
  ['#open-source .wrap > :not(.sec-head)', '', true],
  ['.faq details', '', true],
  ['.final .wrap > *', '', true],
]

export function Reveal({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const tagged: HTMLElement[] = []
    for (const [selector, variant, stagger] of GROUPS) {
      root.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
        if (el.hasAttribute('data-reveal')) return
        el.setAttribute('data-reveal', variant)
        if (stagger) el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 80}ms`)
        tagged.push(el)
      })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    )
    root.classList.add('reveal-on')
    const frame = requestAnimationFrame(() => tagged.forEach((el) => observer.observe(el)))

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      root.classList.remove('reveal-on')
      for (const el of tagged) {
        el.removeAttribute('data-reveal')
        el.classList.remove('is-in')
        el.style.removeProperty('--reveal-delay')
      }
    }
  }, [rootId])

  return null
}
