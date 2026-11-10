'use client'

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
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
  formatAmountText,
  nextUnusedCurrency,
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
  /** Show every row error now (set after a blocked save), not only for rows the user has left. */
  revealErrors: boolean
  /** Currency of the search-parameters salary band, offered first for a new salary row. */
  preferredCurrency?: string | null
}

export function EligibilityCard({ value, onChange, errors, revealErrors, preferredCurrency }: Props) {
  // DOM ids come from useId (hydration-safe); row keys are deterministic for
  // loaded rows and per-instance for rows added here.
  const uid = useId()
  const nextRowId = useRef(0)
  function newRowKey(prefix: string) {
    nextRowId.current += 1
    return `${prefix}-new-${nextRowId.current}`
  }
  const ids = {
    currentCountry: `${uid}-current-country`,
    citizenshipAdd: `${uid}-citizenship-add`,
    addVisa: `${uid}-add-visa`,
    addFloor: `${uid}-add-floor`,
    addDeal: `${uid}-add-deal`,
    visa: (key: string) => `${uid}-${key}`,
    floor: (key: string) => `${uid}-${key}`,
    deal: (key: string) => `${uid}-${key}`,
    citizenshipRemove: (code: string) => `${uid}-citizenship-${code}-remove`,
  }

  // Focus to move after the next render (new row, removed row, confirmed suggestion).
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  // Row errors appear once the user has left the row, so a target isn't
  // flagged while it's still being typed.
  const [touchedRows, setTouchedRows] = useState<ReadonlySet<string>>(new Set())
  const [activeRow, setActiveRow] = useState<string | null>(null)
  const rowFocusProps = (key: string) => ({
    onFocus: () => setActiveRow(key),
    onBlur: (e: FocusEvent<HTMLDivElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setActiveRow((a) => (a === key ? null : a))
      setTouchedRows((t) => (t.has(key) ? t : new Set(t).add(key)))
    },
  })
  const showRowErrors = (key: string) => revealErrors || (touchedRows.has(key) && activeRow !== key)

  function set<K extends keyof EligibilityDraft>(key: K, next: EligibilityDraft[K]) {
    onChange({ ...value, [key]: next })
  }

  /** Remove a row, then focus the next row's first control, or the section's add button. */
  function removeRow<T extends { key: string }>(
    rows: T[],
    key: string,
    firstControlId: (key: string) => string,
    addButtonId: string,
  ): T[] {
    const index = rows.findIndex((r) => r.key === key)
    const next = rows[index + 1]
    pendingFocus.current = next ? firstControlId(next.key) : addButtonId
    return rows.filter((r) => r.key !== key)
  }

  // ── Current country ──
  const suggested = value.currentCountrySuggested && value.currentCountry !== null
  function confirmSuggestion() {
    pendingFocus.current = ids.currentCountry
    onChange({ ...value, currentCountrySuggested: false })
  }

  // ── Citizenships ──
  function removeCitizenship(code: string) {
    const index = value.citizenships.indexOf(code)
    const next = value.citizenships[index + 1]
    pendingFocus.current = next ? ids.citizenshipRemove(next) : ids.citizenshipAdd
    set('citizenships', value.citizenships.filter((c) => c !== code))
  }

  // ── Visas ──
  function updateVisa(key: string, patch: Partial<VisaDraft>) {
    set('visas', value.visas.map((v) => (v.key === key ? { ...v, ...patch } : v)))
  }
  function addVisa() {
    const key = newRowKey('visa')
    pendingFocus.current = `${ids.visa(key)}-country`
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
    const key = newRowKey('floor')
    pendingFocus.current = `${ids.floor(key)}-currency`
    set('salaryFloors', [...value.salaryFloors, { key, currency, floor: '', target: '' }])
  }

  // ── Dealbreakers ──
  const filledDealbreakers = value.dealbreakers.filter((d) => d.text.trim()).length
  const canAddDealbreaker = value.dealbreakers.length < DEALBREAKER_MAX_COUNT
  function addDealbreaker() {
    if (!canAddDealbreaker) return
    const key = newRowKey('deal')
    pendingFocus.current = ids.deal(key)
    set('dealbreakers', [...value.dealbreakers, { key, text: '' }])
  }
  function handleDealbreakerKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === value.dealbreakers.length - 1 && value.dealbreakers[index].text.trim()) addDealbreaker()
    }
  }

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
            <Label id={`${ids.currentCountry}-label`} htmlFor={ids.currentCountry}>Current country</Label>
            <CountryCombobox
              id={ids.currentCountry}
              labelId={`${ids.currentCountry}-label`}
              value={value.currentCountry}
              onChange={(code) => onChange({ ...value, currentCountry: code, currentCountrySuggested: false })}
              onClear={() => onChange({ ...value, currentCountry: null, currentCountrySuggested: false })}
              className={cn(suggested && 'text-muted-foreground')}
              aria-describedby={`${ids.currentCountry}-help`}
            />
            {suggested ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p id={`${ids.currentCountry}-help`} className={helpText}>
                  Suggested from your profile location. Not saved until you confirm it.
                </p>
                <Button type="button" variant="outline" size="xs" onClick={confirmSuggestion}>
                  Confirm {countryName(value.currentCountry!)}
                </Button>
              </div>
            ) : (
              <p id={`${ids.currentCountry}-help`} className={helpText}>
                Where you live now. Roles that need you based elsewhere get flagged.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label id={`${ids.citizenshipAdd}-label`} htmlFor={ids.citizenshipAdd}>Citizenships</Label>
            {value.citizenships.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Your citizenships">
                {value.citizenships.map((code) => (
                  <li key={code}>
                    <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs font-normal">
                      {countryName(code)}
                      <button
                        type="button"
                        id={ids.citizenshipRemove(code)}
                        onClick={() => removeCitizenship(code)}
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
              id={ids.citizenshipAdd}
              labelId={`${ids.citizenshipAdd}-label`}
              value={null}
              onChange={(code) => set('citizenships', [...value.citizenships, code])}
              exclude={value.citizenships}
              placeholder={value.citizenships.length ? 'Add another country' : 'Add a country'}
              aria-describedby={`${ids.citizenshipAdd}-help`}
            />
            <p id={`${ids.citizenshipAdd}-help`} className={helpText}>
              With your visas, decides which countries need sponsorship.
            </p>
          </div>
        </div>

        {/* Visas / work permits */}
        <div role="group" aria-labelledby={`${uid}-visas-label`} aria-describedby={`${uid}-visas-help`} className="space-y-3">
          <div className="space-y-1">
            <h3 id={`${uid}-visas-label`} className="text-sm leading-none font-medium">Visas &amp; work permits</h3>
            <p id={`${uid}-visas-help`} className={helpText}>Any permit that lets you work somewhere your citizenship doesn&apos;t cover.</p>
          </div>
          {value.visas.map((visa, i) => {
            const id = ids.visa(visa.key)
            const error = showRowErrors(visa.key) ? errors.visas[visa.key] : undefined
            const label = visa.country ? countryName(visa.country) : `row ${i + 1}`
            return (
              <div key={visa.key} className="space-y-2 rounded-lg border p-3" {...rowFocusProps(visa.key)}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
                  <div className="space-y-1.5">
                    <Label id={`${id}-country-label`} htmlFor={`${id}-country`} className={fieldLabel}>Country</Label>
                    <CountryCombobox
                      id={`${id}-country`}
                      labelId={`${id}-country-label`}
                      value={visa.country}
                      onChange={(code) => updateVisa(visa.key, { country: code })}
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
                    onClick={() =>
                      set('visas', removeRow(value.visas, visa.key, (k) => `${ids.visa(k)}-country`, ids.addVisa))
                    }
                  />
                </div>
                {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
              </div>
            )
          })}
          <Button id={ids.addVisa} type="button" variant="outline" size="sm" onClick={addVisa}>
            <PlusIcon aria-hidden /> Add visa or permit
          </Button>
        </div>

        {/* Salary floors */}
        <div role="group" aria-labelledby={`${uid}-floors-label`} aria-describedby={`${uid}-floors-help`} className="space-y-3">
          <div className="space-y-1">
            <h3 id={`${uid}-floors-label`} className="text-sm leading-none font-medium">Salary floor</h3>
            <p id={`${uid}-floors-help`} className={helpText}>
              Annual gross, one row per currency (&ldquo;90k&rdquo; works). Roles that pay below your floor get flagged.
            </p>
          </div>
          {value.salaryFloors.map((row) => {
            const id = ids.floor(row.key)
            const rowErrors = showRowErrors(row.key) ? (errors.floors[row.key] ?? {}) : {}
            const symbol = currencySymbol(row.currency)
            return (
              <div key={row.key} className="space-y-2 rounded-lg border p-3" {...rowFocusProps(row.key)}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-currency`} className={fieldLabel}>Currency</Label>
                    <Select
                      value={row.currency}
                      onValueChange={(next) => { if (next) updateFloor(row.key, { currency: next }) }}
                    >
                      <SelectTrigger id={`${id}-currency`} className="h-8 w-full">
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
                    onClick={() =>
                      set(
                        'salaryFloors',
                        removeRow(value.salaryFloors, row.key, (k) => `${ids.floor(k)}-currency`, ids.addFloor),
                      )
                    }
                  />
                </div>
                {rowErrors.floor && <p id={`${id}-floor-error`} className="text-xs text-destructive">{rowErrors.floor}</p>}
                {rowErrors.target && <p id={`${id}-target-error`} className="text-xs text-destructive">{rowErrors.target}</p>}
              </div>
            )
          })}
          <Button id={ids.addFloor} type="button" variant="outline" size="sm" onClick={addFloor} disabled={!canAddFloor}>
            <PlusIcon aria-hidden /> Add currency
          </Button>
        </div>

        {/* Dealbreakers */}
        <div role="group" aria-labelledby={`${uid}-deals-label`} aria-describedby={`${uid}-deals-help`} className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`${uid}-deals-label`} className="text-sm leading-none font-medium">Dealbreakers</h3>
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {filledDealbreakers}/{DEALBREAKER_MAX_COUNT}
                <span className="sr-only"> dealbreakers</span>
              </span>
            </div>
            <p id={`${uid}-deals-help`} className={helpText}>Short lines, each checked against the job description.</p>
          </div>
          {value.dealbreakers.length > 0 && (
            <ul className="space-y-2">
              {value.dealbreakers.map((line, i) => (
                <li key={line.key} className="flex items-center gap-2">
                  <Input
                    id={ids.deal(line.key)}
                    value={line.text}
                    maxLength={DEALBREAKER_MAX_LENGTH}
                    onChange={(e) =>
                      set('dealbreakers', value.dealbreakers.map((d) => (d.key === line.key ? { ...d, text: e.target.value } : d)))
                    }
                    onKeyDown={(e) => handleDealbreakerKeyDown(e, i)}
                    placeholder={`e.g. ${DEALBREAKER_EXAMPLES[i % DEALBREAKER_EXAMPLES.length]}`}
                    aria-label={`Dealbreaker ${i + 1}`}
                  />
                  <RemoveButton
                    label={line.text.trim() ? `Remove dealbreaker: ${line.text.trim()}` : `Remove dealbreaker ${i + 1}`}
                    onClick={() => set('dealbreakers', removeRow(value.dealbreakers, line.key, ids.deal, ids.addDeal))}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button id={ids.addDeal} type="button" variant="outline" size="sm" onClick={addDealbreaker} disabled={!canAddDealbreaker}>
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
  /** Raw text as typed. */
  value: string
  onChange: (value: string) => void
  placeholder: string
  error?: string
}

/** Amount input with a currency prefix. Shows "90,000" when idle and the typed text while editing. */
function AmountField({ id, label, optional, symbol, value, onChange, placeholder, error }: AmountFieldProps) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-1">
      <Label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && <> <span className="text-muted-foreground/70">(optional)</span></>}
      </Label>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText className={cn(symbol.length > 1 && 'text-xs')}>{symbol}</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={editing ? value : formatAmountText(value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="tabular-nums"
        />
      </InputGroup>
    </div>
  )
}
