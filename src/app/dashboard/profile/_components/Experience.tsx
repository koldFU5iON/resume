'use client'

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter, DialogClose
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { createExperience } from "@/modules/profile/actions"

// ── Experience add/edit dialog ────────────────────────────────────────────────

export function ExperienceDialog({
  open, onOpenChange, onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSave: (data: Parameters<typeof createExperience>[0]) => void
}) {
  const [remote, setRemote] = useState(false)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const endDateStr = fd.get('endDate') as string
    onSave({
      company: fd.get('company') as string,
      role: fd.get('role') as string,
      location: (fd.get('location') as string) || undefined,
      remote,
      startDate: new Date(fd.get('startDate') as string),
      endDate: endDateStr ? new Date(endDateStr) : undefined,
      summary: '',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Experience</DialogTitle>
          <DialogDescription>
            Add the basics — you can fill in notes and activities on the next page.
          </DialogDescription>
        </DialogHeader>
        <form key="new" onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="exp-company">Company</Label>
                <Input id="exp-company" name="company" required />
              </Field>
              <Field>
                <Label htmlFor="exp-role">Role / Title</Label>
                <Input id="exp-role" name="role" required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="exp-location">Location</Label>
                <Input id="exp-location" name="location" placeholder="City, Country" />
              </Field>
              <Field>
                <div className="flex items-center gap-2 mt-6">
                  <Checkbox
                    id="exp-remote"
                    checked={remote}
                    onCheckedChange={(checked) => setRemote(!!checked)}
                  />
                  <Label htmlFor="exp-remote">Remote position</Label>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor="exp-start">Start Date</Label>
                <Input id="exp-start" name="startDate" type="date" required />
              </Field>
              <Field>
                <Label htmlFor="exp-end">End Date</Label>
                <Input id="exp-end" name="endDate" type="date" />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="secondary">Cancel</Button>} />
            <Button type="submit">Add & Open</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

