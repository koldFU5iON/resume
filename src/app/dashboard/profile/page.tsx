import { redirect } from 'next/navigation'
import { overviewHref } from '@/modules/profile/note-index'

export default function Page() {
  redirect(overviewHref())
}
