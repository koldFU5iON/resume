'use client'

import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'

type Tab = 'active' | 'archived'

export function ApplicationTabs({ initialTab, children }: {
  initialTab: Tab
  children: ReactNode
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  // A create deep link needs the Active panel mounted (JobList consumes the
  // query there). Switch during render, once; the remembered tab cookie is
  // left alone so a later visit still opens where the user left off.
  const wantsCreate = useSearchParams().get('create') === '1'
  if (wantsCreate && tab !== 'active') setTab('active')

  return (
    <Tabs
      value={tab}
      className="w-full"
      onValueChange={(value) => {
        if (value === 'active' || value === 'archived') {
          setTab(value)
          document.cookie = `jobs-tab=${value}; Path=/dashboard/job-applications; Max-Age=31536000; SameSite=Lax`
        }
      }}
    >
      {children}
    </Tabs>
  )
}
