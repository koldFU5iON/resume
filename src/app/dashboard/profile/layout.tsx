import { getFullProfile } from '@/modules/profile/queries'
import { buildNoteIndex } from '@/modules/profile/note-index'
import { NotesNav } from './_components/NotesNav'

/**
 * The note workspace: the notes list beside whichever note, or Records page,
 * is open. The list lives here, so moving between notes does not rebuild it.
 */
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const profile = await getFullProfile()
  return (
    <div className="flex flex-1 flex-col min-[1100px]:min-h-0 min-[1100px]:flex-row">
      <NotesNav index={buildNoteIndex(profile)} />
      <div className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0">{children}</div>
    </div>
  )
}
