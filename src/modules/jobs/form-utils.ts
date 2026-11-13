import type { ExtractedJob } from './extract-utils'

type FormLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: (name: any, value: any, options?: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValues: (name: any) => unknown
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

// Copies non-empty extracted values into the form. With a snapshot (the form
// values when extraction started), a field the user changed since is kept.
export function applyExtractedData(
  form: FormLike,
  data: ExtractedJob,
  snapshot?: Record<string, unknown>,
) {
  const set = (name: string, value: unknown, options?: object) => {
    if (!value) return
    if (snapshot && !sameValue(form.getValues(name), snapshot[name])) return
    form.setValue(name, value, options)
  }
  set('title', data.title, { shouldValidate: true, shouldDirty: true })
  set('company', data.company, { shouldValidate: true, shouldDirty: true })
  set('location', data.location, { shouldDirty: true })
  set('jobDescription', data.jobDescription, { shouldDirty: true })
  set('jobNumber', data.jobNumber, { shouldDirty: true })
  set('salaryBand', data.salaryBand, { shouldDirty: true })
  set('datePublished', data.datePublished, { shouldDirty: true })
}

// Identity of a duplicate match set, independent of order.
export function duplicateKey(matches: { id: string }[]) {
  return matches.map(m => m.id).sort().join(',')
}

// The one link policy: only http(s) URLs are stored or rendered as links.
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
