'use client'

import { useState, type KeyboardEvent } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CURRENCIES, countryName } from '@/modules/job-assessment/eligibility'
import { DEALBREAKER_MAX_COUNT, DEALBREAKER_MAX_LENGTH } from '@/modules/search-profile/schema'
import { CountryCombobox } from './country-combobox'
import {
  currencySymbol,
  formatAmount,
  newRowKey,
  nextUnusedCurrency,
  parseAmount,
  type EligibilityDraft,
  type EligibilityDraftErrors,
  type SalaryFloorDraft,
  type VisaDraft,
} from './eligibility-draft'

const DEALBREAKER_EXAMPLES = ['Fixed-term contract', 'Regular weekend on-call', 'Mostly travel', 'Fully on-site']

const helpText = 'text-xs text-muted-foreground'
const fieldLabel = 'text-xs font-normal text-muted-foreground'

type Props = {
  value: EligibilityDraft
  onChange: (next: EligibilityDraft) => void
  errors: EligibilityDraftErrors
  /** Country parsed from the profile location; shown as a hint while it's the selected value. */
  suggestedCountry: string | null
  /** Currency of the search-parameters salary band, offered first for a new salary row. */
  preferredCurrency?: string | null
}

export function EligibilityCard({ value, onChange, errors, suggestedCountry, preferredCurrency }: Props) {
  // Key of the row added last, so its first field can take focus.
  const [focusKey, setFocusKey] = useState<string | null>(null)

  function set<K extends keyof EligibilityDraft>(key: K, next: EligibilityDraft[K]) {
    onChange({ ...value, [key]: next })
  }

  // ── Visas ──
  function updateVisa(key: string, patch: Partial<VisaDraft>) {
    set('visas', value.visas.map((v) => (v.key === key ? { ...v, ...patch } : v)))
  }
  function addVisa() {
    const key = newRowKey()
    setFocusKey(key)
    set('visas', [...value.visas, { key, country: null, type: '', expiresOn: '' }])
  }

  // ── Salary floors ──
  const usedCurrencies = value.salaryFloors.map((f) => f.currency)
  const canAddFloor = nextUnusedCurrency(usedCurrencies) !== null
  function updateFloor(key: string, patch: Partial<SalaryFloorDraft>) {
    set('salaryFloors', value.salaryFloors.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }
  function addFloor() {
    const currency = nextUnusedCurrency(usedCurrencies, preferredCurrency)
    if (!currency) return
    const key = newRowKey()
    setFocusKey(key)
    set('salaryFloors', [...value.salaryFloors, { key, currency, floor: null, target: null }])
  }

  // ── Dealbreakers ──
  const filledDealbreakers = value.dealbreakers.filter((d) => d.text.trim()).length
  const canAddDealbreaker = value.dealbreakers.length < DEALBREAKER_MAX_COUNT
  function addDealbreaker() {
    if (!canAddDealbreaker) return
    const key = newRowKey()
    setFocusKey(key)
    set('dealbreakers', [...value.dealbreakers, { key, text: '' }])
  }
  function handleDealbreakerKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === value.dealbreakers.length - 1 && value.dealbreakers[index].text.trim()) addDealbreaker()
    }
  }

  const showSuggestionHint = suggestedCountry !== null && value.currentCountry === suggestedCountry

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Eligibility &amp; dealbreakers</CardTitle>
        <CardDescription className="text-xs">
          Used by the early job assessment to flag roles you can&apos;t take before you spend time on them
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Where you live and where you can work */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label id="eligibility-current-country-label" htmlFor="eligibility-current-country">Current country</Label>
            <CountryCombobox
              id="eligibility-current-country"
              labelId="eligibility-current-country-label"
              value={value.currentCountry}
              onChange={(code) => set('currentCountry', code)}
              aria-describedby="eligibility-current-country-help"
            />
            <p id="eligibility-current-country-help" className={helpText}>
              {showSuggestionHint
                ? 'Suggested from your profile location. Change it if it’s wrong; it’s saved when you save.'
                : 'Where you live now. Roles that need you based elsewhere get flagged.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label id="eligibility-citizenship-label" htmlFor="eligibility-citizenship-add">Citizenships</Label>
            {value.citizenships.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Your citizenships">
                {value.citizenships.map((code) => (
                  <li key={code}>
                    <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                      {countryName(code)}
                      <button
                        type="button"
                        onClick={() => set('citizenships', value.citizenships.filter((c) => c !== code))}
                        className="rounded-sm p-0.5 transition-colors outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove citizenship: ${countryName(code)}`}
                      >
                        <XIcon className="size-3" aria-hidden />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <CountryCombobox
              id="eligibility-citizenship-add"
              labelId="eligibility-citizenship-label"
              value={null}
              onChange={(code) => set('citizenships', [...value.citizenships, code])}
              exclude={value.citizenships}
              placeholder={value.citizenships.length ? 'Add another country' : 'Add a country'}
              aria-describedby="eligibility-citizenship-help"
            />
            <p id="eligibility-citizenship-help" className={helpText}>
              With your visas, decides which countries need sponsorship.
            </p>
          </div>
        </div>

        {/* Visas / work permits */}
        <div role="group" aria-labelledby="eligibility-visas-label" aria-describedby="eligibility-visas-help" className="space-y-3">
          <div className="space-y-1">
            <h3 id="eligibility-visas-label" className="text-sm leading-none font-medium">Visas &amp; work permits</h3>
            <p id="eligibility-visas-help" className={helpText}>Any permit that lets you work somewhere your citizenship doesn&apos;t cover.</p>
          </div>
          {value.visas.map((visa, i) => {
            const id = `eligibility-visa-${visa.key}`
            const error = errors.visas[visa.key]
            const label = visa.country ? countryName(visa.country) : `row ${i + 1}`
            return (
              <div key={visa.key} className="space-y-2 rounded-lg border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
                  <div className="space-y-1.5">
                    <Label id={`${id}-country-label`} htmlFor={`${id}-country`} className={fieldLabel}>Country</Label>
                    <CountryCombobox
                      id={`${id}-country`}
                      labelId={`${id}-country-label`}
                      value={visa.country}
                      onChange={(code) => updateVisa(visa.key, { country: code })}
                      autoFocus={focusKey === visa.key}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5 sm:col-span-1">
                    <Label htmlFor={`${id}-type`} className={fieldLabel}>Type</Label>
                    <Input
                      id={`${id}-type`}
                      value={visa.type}
                      maxLength={100}
                      onChange={(e) => updateVisa(visa.key, { type: e.target.value })}
                      placeholder="e.g. Skilled Worker"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5 sm:col-span-1">
                    <Label htmlFor={`${id}-expires`} className={fieldLabel}>
                      Expires <span className="text-muted-foreground/70">(optional)</span>
                    </Label>
                    <Input
                      id={`${id}-expires`}
                      type="date"
                      value={visa.expiresOn}
                      onChange={(e) => updateVisa(visa.key, { expiresOn: e.target.value })}
                      className="dark:scheme-dark"
                    />
                  </div>
                  <RowRemoveButton
                    label={`Remove visa for ${label}`}
                    onClick={() => set('visas', value.visas.filter((v) => v.key !== visa.key))}
                  />
                </div>
                {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" onClick={addVisa}>
            <PlusIcon aria-hidden /> Add visa or permit
          </Button>
        </div>

        {/* Salary floors */}
        <div role="group" aria-labelledby="eligibility-floors-label" aria-describedby="eligibility-floors-help" className="space-y-3">
          <div className="space-y-1">
            <h3 id="eligibility-floors-label" className="text-sm leading-none font-medium">Salary floor</h3>
            <p id="eligibility-floors-help" className={helpText}>
              Annual gross, one row per currency. Roles that pay below your floor get flagged.
            </p>
          </div>
          {value.salaryFloors.map((row) => {
            const id = `eligibility-floor-${row.key}`
            const rowErrors = errors.floors[row.key] ?? {}
            const symbol = currencySymbol(row.currency)
            return (
              <div key={row.key} className="space-y-2 rounded-lg border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-currency`} className={fieldLabel}>Currency</Label>
                    <Select
                      value={row.currency}
                      onValueChange={(next) => { if (next) updateFloor(row.key, { currency: next }) }}
                    >
                      <SelectTrigger
                        id={`${id}-currency`}
                        className="h-8 w-full"
                        autoFocus={focusKey === row.key}
                      >
                        <SelectValue>{row.currency}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem
                            key={c.code}
                            value={c.code}
                            disabled={c.code !== row.currency && usedCurrencies.includes(c.code)}
                          >
                            <span className="w-10 font-medium">{c.code}</span>
                            <span className="text-muted-foreground">{c.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <AmountField
                    id={`${id}-floor`}
                    label="Floor"
                    symbol={symbol}
                    value={row.floor}
                    onChange={(floor) => updateFloor(row.key, { floor })}
                    placeholder="Minimum"
                    error={rowErrors.floor}
                  />
                  <AmountField
                    id={`${id}-target`}
                    label="Target"
                    optional
                    symbol={symbol}
                    value={row.target}
                    onChange={(target) => updateFloor(row.key, { target })}
                    placeholder="Aiming for"
                    error={rowErrors.target}
                  />
                  <RowRemoveButton
                    label={`Remove ${row.currency} salary floor`}
                    onClick={() => set('salaryFloors', value.salaryFloors.filter((f) => f.key !== row.key))}
                  />
                </div>
                {rowErrors.floor && <p id={`${id}-floor-error`} className="text-xs text-destructive">{rowErrors.floor}</p>}
                {rowErrors.target && <p id={`${id}-target-error`} className="text-xs text-destructive">{rowErrors.target}</p>}
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" onClick={addFloor} disabled={!canAddFloor}>
            <PlusIcon aria-hidden /> Add currency
          </Button>
        </div>

        {/* Dealbreakers */}
        <div role="group" aria-labelledby="eligibility-dealbreakers-label" aria-describedby="eligibility-dealbreakers-help" className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="eligibility-dealbreakers-label" className="text-sm leading-none font-medium">Dealbreakers</h3>
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {filledDealbreakers}/{DEALBREAKER_MAX_COUNT}
                <span className="sr-only"> dealbreakers</span>
              </span>
            </div>
            <p id="eligibility-dealbreakers-help" className={helpText}>Short lines, each checked against the job description.</p>
          </div>
          {value.dealbreakers.length > 0 && (
            <ul className="space-y-2">
              {value.dealbreakers.map((line, i) => (
                <li key={line.key} className="flex items-center gap-2">
                  <Input
                    value={line.text}
                    maxLength={DEALBREAKER_MAX_LENGTH}
                    autoFocus={focusKey === line.key}
                    onChange={(e) =>
                      set('dealbreakers', value.dealbreakers.map((d) => (d.key === line.key ? { ...d, text: e.target.value } : d)))
                    }
                    onKeyDown={(e) => handleDealbreakerKeyDown(e, i)}
                    placeholder={`e.g. ${DEALBREAKER_EXAMPLES[i % DEALBREAKER_EXAMPLES.length]}`}
                    aria-label={`Dealbreaker ${i + 1}`}
                  />
                  <RemoveButton
                    label={line.text.trim() ? `Remove dealbreaker: ${line.text.trim()}` : `Remove dealbreaker ${i + 1}`}
                    onClick={() => set('dealbreakers', value.dealbreakers.filter((d) => d.key !== line.key))}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button type="button" variant="outline" size="sm" onClick={addDealbreaker} disabled={!canAddDealbreaker}>
            <PlusIcon aria-hidden /> Add dealbreaker
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('text-muted-foreground hover:text-destructive', className)}
    >
      <XIcon aria-hidden />
    </Button>
  )
}

/**
 * Remove button for a repeatable row grid: beside the first field on mobile,
 * last column from `sm` up. The spacer matches a field label's height so the
 * button lines up with the controls.
 */
function RowRemoveButton(props: { label: string; onClick: () => void }) {
  return (
    <div className="col-start-2 row-start-1 space-y-1.5 sm:col-start-4">
      <div aria-hidden className="h-4" />
      <RemoveButton {...props} />
    </div>
  )
}

type AmountFieldProps = {
  id: string
  label: string
  optional?: boolean
  symbol: string
  value: number | null
  onChange: (value: number | null) => void
  placeholder: string
  error?: string
}

/** Number input with a currency prefix. Shows "90,000" when idle and plain digits while editing. */
function AmountField({ id, label, optional, symbol, value, onChange, placeholder, error }: AmountFieldProps) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-1">
      <Label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && <span className="text-muted-foreground/70">(optional)</span>}
      </Label>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText className={cn(symbol.length > 1 && 'text-xs')}>{symbol}</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={editing ? (value === null ? '' : String(value)) : formatAmount(value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => onChange(parseAmount(e.target.value))}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="tabular-nums"
        />
      </InputGroup>
    </div>
  )
}
