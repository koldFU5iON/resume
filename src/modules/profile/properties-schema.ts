// The rules for the Properties tab's fields. Pure (no database), so the form
// checks its input with the same schema the server enforces: a server error
// message does not survive to the browser in production, so the person has to
// be told what is wrong before it is sent.

import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max)
/** Empty or missing becomes null. */
const optionalText = (max: number) => text(max).nullish().transform((v) => v || null)
/** A date, or nothing: an empty field arrives as an empty string. */
const optionalDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullish()).transform((v) => v ?? null)

/** A web address, or nothing. Anything else is refused rather than stored. */
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), 'Enter a web address starting with http:// or https://')

const dateOrder = (v: { startDate: Date | null; endDate: Date | null }) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate

export const ExperiencePropertiesSchema = z
  .object({
    company: text(200).min(1, 'Company is required'),
    role: text(200).min(1, 'Role is required'),
    location: optionalText(200),
    remote: z.boolean(),
    startDate: z.coerce.date(),
    endDate: optionalDate,
  })
  .refine(dateOrder, { message: 'The end date is before the start date', path: ['endDate'] })

export const ProjectPropertiesSchema = z
  .object({
    name: text(200).min(1, 'Name is required'),
    description: text(2000),
    url: optionalUrl,
    repoUrl: optionalUrl,
    startDate: optionalDate,
    endDate: optionalDate,
    /** The selected role. An empty selection resolves to Independent projects. */
    experienceId: z.string().nullish().transform((v) => v || null),
  })
  .refine(dateOrder, { message: 'The end date is before the start date', path: ['endDate'] })

export type ExperienceProperties = z.input<typeof ExperiencePropertiesSchema>
export type ProjectProperties = z.input<typeof ProjectPropertiesSchema>

