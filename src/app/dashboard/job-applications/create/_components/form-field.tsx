import { Controller, useFormContext } from "react-hook-form"
import { Field, FieldLabel, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type FormFieldOption = { value: string; label: string }

interface FormFieldProps {
  name: string
  label: string
  type?: string
  placeholder?: string
  required?: boolean
  rows?: number
  options?: FormFieldOption[]
}

// <input type="date"> needs a local YYYY-MM-DD string, while the form holds a Date.
function toDateInputValue(value: unknown): string {
  const date =
    value instanceof Date ? value : value ? new Date(value as string) : null
  if (!date || Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function FormField({
  name,
  label,
  type = "text",
  placeholder,
  required = false,
  rows,
  options,
}: FormFieldProps) {
  const { control } = useFormContext()
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel>
            {label} {required && <span className="text-destructive">*</span>}
          </FieldLabel>
          {type === "select" ? (
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <SelectTrigger
                className="w-full"
                aria-invalid={fieldState.invalid}
              >
                <SelectValue placeholder={placeholder ?? "Select..."} />
              </SelectTrigger>
              <SelectContent>
                {options?.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : type === "textarea" ? (
            <Textarea
              {...field}
              placeholder={placeholder}
              rows={rows}
              aria-invalid={fieldState.invalid}
            />
          ) : type === "date" ? (
            <div className="flex gap-2">
              <Input
                {...field}
                type="date"
                value={toDateInputValue(field.value)}
                onChange={(e) =>
                  field.onChange(
                    e.target.value
                      ? new Date(`${e.target.value}T00:00:00`)
                      : undefined,
                  )
                }
                aria-invalid={fieldState.invalid}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const now = new Date()
                  field.onChange(
                    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
                  )
                }}
              >
                Today
              </Button>
            </div>
          ) : (
            <Input
              {...field}
              type={type}
              placeholder={placeholder}
              aria-invalid={fieldState.invalid}
            />
          )}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )
}
