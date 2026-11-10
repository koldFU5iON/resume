'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { LocationTagsInput } from '@/app/dashboard/job-hunt/_components/location-tags-input'
import { saveSearchProfile } from '@/modules/search-profile/actions'
import { SuggestionsPanel } from './suggestions-panel'
import { EligibilityCard } from './eligibility-card'
import {
  fromEligibilityDraft,
  hasDraftErrors,
  toEligibilityDraft,
  validateEligibilityDraft,
  type EligibilityDraft,
} from './eligibility-draft'
import type { SearchProfile, SearchSuggestion, SalaryBand } from '@/modules/search-profile/schema'

const REMOTE_OPTIONS = [
  { value: 'remote' as const,   label: 'Remote' },
  { value: 'hybrid' as const,   label: 'Hybrid' },
  { value: 'onsite' as const,   label: 'On-site' },
  { value: 'flexible' as const, label: 'Flexible' },
]

const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD']

type Props = {
  initialProfile: SearchProfile
  initialSuggestions: SearchSuggestion[]
  /** Country parsed from the profile location; prefills `eligibility.currentCountry` when it's unset. */
  suggestedCountry: string | null
}

export function SearchContextForm({ initialProfile, initialSuggestions, suggestedCountry }: Props) {
  const [profile, setProfile] = useState<SearchProfile>(initialProfile)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>(initialSuggestions)
  // Eligibility is edited as a draft (rows can be half-filled) and folded back into the profile on save.
  const [eligibility, setEligibility] = useState<EligibilityDraft>(() =>
    toEligibilityDraft(initialProfile.eligibility, suggestedCountry),
  )
  const eligibilityErrors = validateEligibilityDraft(eligibility)
  const [isPending, startTransition] = useTransition()

  function update<K extends keyof SearchProfile>(key: K, value: SearchProfile[K]) {
    setProfile((p) => ({ ...p, [key]: value }))
  }

  function handleSave() {
    if (hasDraftErrors(eligibilityErrors)) {
      toast.error('Fix the highlighted eligibility fields before saving')
      return
    }
    startTransition(async () => {
      await saveSearchProfile({ ...profile, eligibility: fromEligibilityDraft(eligibility) })
      toast.success('Search context saved')
    })
  }

  const salaryBand = profile.salaryBand ?? { min: null, max: null, currency: 'GBP' }

  function updateSalary(patch: Partial<SalaryBand>) {
    update('salaryBand', { ...salaryBand, ...patch })
  }

  function handleSalaryInput(field: 'min' | 'max', raw: string) {
    const stripped = raw.replace(/[^0-9]/g, '')
    const num = stripped ? Number(stripped) : null
    updateSalary({ [field]: num })
  }

  function onSuggestionAccepted(id: string, field: keyof SearchProfile, value: unknown) {
    setProfile((p) => ({ ...p, [field]: value }))
    setSuggestions((s) => s.filter((x) => x.id !== id))
  }

  function onSuggestionDismissed(id: string) {
    setSuggestions((s) => s.filter((x) => x.id !== id))
  }

  return (
    <div className="space-y-4">
      <SuggestionsPanel
        suggestions={suggestions}
        currentProfile={profile}
        onAccepted={onSuggestionAccepted}
        onDismissed={onSuggestionDismissed}
      />

      {/* Identity */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="preferredName">Preferred name</Label>
          <Input
            id="preferredName"
            value={profile.preferredName}
            onChange={(e) => update('preferredName', e.target.value)}
            placeholder="What should the app call you?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currentRole">Current / last role</Label>
          <Input
            id="currentRole"
            value={profile.currentRole}
            onChange={(e) => update('currentRole', e.target.value)}
            placeholder="e.g. Communications Operations"
          />
        </div>
      </div>

      {/* Search parameters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Search parameters</CardTitle>
          <CardDescription className="text-xs">Used for job board scanning and AI features</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Target roles</Label>
            <LocationTagsInput
              value={profile.roles}
              onChange={(roles) => update('roles', roles)}
              placeholder="e.g. Director of Operations — press Enter to add"
            />
            <p className="text-xs text-muted-foreground">First entry is your primary target role; extras are search aliases</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Countries</Label>
              <LocationTagsInput
                value={profile.countries}
                onChange={(countries) => update('countries', countries)}
                placeholder="e.g. UK, Ireland — press Enter"
              />
            </div>
            <div className="space-y-2">
              <Label>Remote preference</Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {REMOTE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('remotePreference', profile.remotePreference === opt.value ? '' : opt.value)}
                    className={cn(
                      'rounded-md border px-3 py-1 text-sm transition-colors',
                      profile.remotePreference === opt.value
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Salary band</Label>
            <div className="flex items-center gap-2">
              <select
                value={salaryBand.currency}
                onChange={(e) => updateSalary({ currency: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Input
                className="w-32"
                value={salaryBand.min != null ? String(salaryBand.min) : ''}
                onChange={(e) => handleSalaryInput('min', e.target.value)}
                placeholder="Min"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                className="w-32"
                value={salaryBand.max != null ? String(salaryBand.max) : ''}
                onChange={(e) => handleSalaryInput('max', e.target.value)}
                placeholder="Max (optional)"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Career narrative */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Career narrative</CardTitle>
          <CardDescription className="text-xs">Used by AI features only — helps the coach understand your direction</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="careerGoals">Where you&apos;re heading</Label>
            <Textarea
              id="careerGoals"
              value={profile.careerGoals}
              onChange={(e) => update('careerGoals', e.target.value)}
              placeholder="Director-level ops at a mission-driven tech company. Open to dev ecosystem or SaaS roles…"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pivotContext">
              Career change context{' '}
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="pivotContext"
              value={profile.pivotContext}
              onChange={(e) => update('pivotContext', e.target.value)}
              placeholder="Transitioning from agency comms into in-house tech ops. Strong background in…"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="extraContext">Anything else useful</Label>
            <Textarea
              id="extraContext"
              value={profile.extraContext}
              onChange={(e) => update('extraContext', e.target.value)}
              placeholder="Constraints, roles to avoid, visa requirements, things you often repeat when tailoring applications…"
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      <EligibilityCard
        value={eligibility}
        onChange={setEligibility}
        errors={eligibilityErrors}
        suggestedCountry={initialProfile.eligibility.currentCountry === null ? suggestedCountry : null}
        preferredCurrency={profile.salaryBand?.currency}
      />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save context'}
        </Button>
      </div>
    </div>
  )
}
