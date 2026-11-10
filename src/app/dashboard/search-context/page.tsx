import { getSearchProfile } from '@/modules/search-profile/queries'
import { SearchContextForm } from './_components/search-context-form'
import { countryFromLocation } from '@/modules/job-assessment/eligibility'

export default async function Page() {
  const { profile, searchProfile, suggestions } = await getSearchProfile()
  // Only a suggestion: the form shows it, and stores it once the user confirms or picks a country.
  const suggestedCountry = searchProfile.eligibility.currentCountry === null ? countryFromLocation(profile.location) : null

  return (
    <div className="max-w-3xl p-4 md:p-8">
      <div className="mb-6 space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Search context</p>
        <h1 className="text-3xl font-semibold tracking-tight">Tell the app who you are and what you&apos;re looking for</h1>
        <p className="text-muted-foreground">
          Used by job-fit scoring, the career coach, and job board scanning. Fill in what you know — the rest can come later.
        </p>
      </div>
      <SearchContextForm
        initialProfile={searchProfile}
        initialSuggestions={suggestions}
        suggestedCountry={suggestedCountry}
      />
    </div>
  )
}
