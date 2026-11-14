import { redirect } from 'next/navigation'
import { noteHref } from '@/modules/profile/note-index'

/** Roles used to have a page of their own; they are notes now. Old links and bookmarks land on the note. */
export default async function ExperienceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(noteHref(id))
}
