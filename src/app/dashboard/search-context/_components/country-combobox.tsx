'use client'

import { useRef, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { COUNTRIES, countryName } from '@/modules/job-assessment/eligibility'

type Props = {
  id: string
  /** Id of the visible label; the trigger is named "<label> <selected country>". */
  labelId?: string
  /** Selected ISO alpha-2 code, or null. */
  value: string | null
  onChange: (code: string) => void
  /** When set and a country is selected, the list offers a "Clear" option that calls this. */
  onClear?: () => void
  /** Shown when `value` is null. */
  placeholder?: ReactNode
  /** Codes to leave out of the list (e.g. citizenships already chosen). */
  exclude?: readonly string[]
  className?: string
  autoFocus?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/** Searchable single-country picker. Type to filter by name or code. */
export function CountryCombobox({
  id,
  labelId,
  value,
  onChange,
  onClear,
  placeholder = 'Select a country',
  exclude,
  className,
  autoFocus,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const options = exclude?.length ? COUNTRIES.filter((c) => !exclude.includes(c.code)) : COUNTRIES

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        autoFocus={autoFocus}
        aria-label={aria['aria-label']}
        aria-labelledby={labelId && !aria['aria-label'] ? `${labelId} ${id}` : undefined}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid'] || undefined}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-full min-w-0 justify-between font-normal',
          !value && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{value ? countryName(value) : placeholder}</span>
        <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        initialFocus={searchRef}
        className="w-(--anchor-width) min-w-64 gap-0 p-0"
      >
        {/* Highlight the current choice when the list opens. */}
        <Command defaultValue={value ? `${countryName(value)} ${value}` : undefined}>
          <CommandInput ref={searchRef} placeholder="Search countries…" aria-label="Search countries" />
          <CommandList className="max-h-64">
            <CommandEmpty>No country found.</CommandEmpty>
            {onClear && value && (
              <>
                <CommandGroup>
                  <CommandItem
                    value="__clear__"
                    keywords={['clear', 'none', 'remove']}
                    onSelect={() => {
                      onClear()
                      setOpen(false)
                    }}
                    className="text-muted-foreground"
                  >
                    <XIcon aria-hidden />
                    Clear selection
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c.code)
                    setOpen(false)
                  }}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  <CheckIcon className={cn('size-4', value === c.code ? 'opacity-100' : 'opacity-0')} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
