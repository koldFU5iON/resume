"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription, PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { extractProfileFromPdf, type ExtractResult } from "@/modules/profile-import/extract"
import { notifyUsageUpdated } from "@/lib/usage-events"
import { commitImportedProfile, type CommitResult } from "@/modules/profile-import/commit"
import type { ExtractedProfile } from "@/modules/profile-import/schema"

type Stage =
  | { name: "idle" }
  | { name: "extracting" }
  | { name: "error"; message: string }
  | { name: "review"; data: ExtractedProfile; excluded: Set<string> }
  | { name: "committing"; data: ExtractedProfile; excluded: Set<string> }
  | { name: "done"; result: CommitResult }

export function ImportProfileDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ name: "idle" })
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStage({ name: "idle" })
    if (fileRef.current) fileRef.current.value = ""
  }

  async function onExtract() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setStage({ name: "error", message: "Choose a PDF file first." })
      return
    }
    setStage({ name: "extracting" })
    const fd = new FormData()
    fd.set("file", file)
    const result: ExtractResult = await extractProfileFromPdf(fd)
    if (!result.ok) {
      setStage({ name: "error", message: result.message })
      return
    }
    notifyUsageUpdated()
    setStage({ name: "review", data: result.data, excluded: new Set() })
  }

  function toggle(key: string) {
    setStage((s) => {
      if (s.name !== "review") return s
      const excluded = new Set(s.excluded)
      if (excluded.has(key)) excluded.delete(key)
      else excluded.add(key)
      return { ...s, excluded }
    })
  }

  function editExpDate(idx: number, field: "startDate" | "endDate", value: string) {
    setStage((s) => {
      if (s.name !== "review") return s
      const data = structuredClone(s.data)
      data.experiences[idx][field] = value || undefined
      return { ...s, data }
    })
  }

  async function onCommit() {
    if (stage.name !== "review") return
    const { data, excluded } = stage
    const payload: ExtractedProfile = {
      ...data,
      experiences: data.experiences.filter((_, i) => !excluded.has(`exp-${i}`)),
      education: data.education.filter((_, i) => !excluded.has(`edu-${i}`)),
      certifications: data.certifications.filter((_, i) => !excluded.has(`cert-${i}`)),
      skills: data.skills.filter((_, i) => !excluded.has(`skill-${i}`)),
    }
    setStage({ name: "committing", data, excluded })
    const result = await commitImportedProfile(payload)
    setStage({ name: "done", result })
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <div className="flex items-center gap-1.5">
        <DialogTrigger render={<Button variant="outline" className="max-md:h-11" />}>Import from PDF</DialogTrigger>
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="LinkedIn PDF export guide"
                className="inline-flex size-6 items-center justify-center text-muted-foreground/60 hover:text-muted-foreground transition-colors max-md:size-11"
              />
            }
          >
            <Info size={14} />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-80">
            <PopoverHeader>
              <PopoverTitle>Best source: LinkedIn export</PopoverTitle>
              <PopoverDescription className="mt-0.5">
                LinkedIn&apos;s PDF export is the most complete input — it includes all roles, dates, and skills in a consistent format.
              </PopoverDescription>
            </PopoverHeader>
            <ol className="mt-2 space-y-1 text-xs text-muted-foreground list-decimal pl-4">
              <li>Open your LinkedIn profile</li>
              <li>Click <strong className="text-foreground">More</strong> (or <strong className="text-foreground">Resources</strong>)</li>
              <li>Select <strong className="text-foreground">Save to PDF</strong></li>
              <li>Upload the downloaded file here</li>
            </ol>
          </PopoverContent>
        </Popover>
      </div>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import profile from PDF</DialogTitle>
          <DialogDescription>
            Upload a CV/resume PDF. Exporting from LinkedIn? Open your profile → <b>More</b> → <b>Save to PDF</b>.
            Importing only fills empty fields — it never overwrites what you&apos;ve already written.
          </DialogDescription>
        </DialogHeader>

        {stage.name === "extracting" ? (
          <ExtractionProgress />
        ) : (stage.name === "idle" || stage.name === "error") && (
          <div className="space-y-3">
            <Input ref={fileRef} type="file" accept="application/pdf" />
            {stage.name === "error" && <p className="text-sm text-destructive">{stage.message}</p>}
            <Button onClick={onExtract}>Extract</Button>
          </div>
        )}

        {stage.name === "review" && (
          <div className="space-y-5">
            <div>
              <h3 className="mb-1 text-sm font-semibold">Experience ({stage.data.experiences.length})</h3>
              {stage.data.experiences.map((e, i) => {
                const key = `exp-${i}`
                return (
                  <div key={key} className="flex items-start gap-2 border-b py-2">
                    <Checkbox checked={!stage.excluded.has(key)} onCheckedChange={() => toggle(key)} className="mt-1" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">{e.role} — {e.company}</p>
                      <div className="flex items-center gap-2">
                        <Label className="w-16 text-xs">Start</Label>
                        <Input value={e.startDate ?? ""} placeholder="YYYY-MM" onChange={(ev) => editExpDate(i, "startDate", ev.target.value)} className="h-7 w-28 text-xs" />
                        <Label className="w-10 text-xs">End</Label>
                        <Input value={e.endDate ?? ""} placeholder="Present" onChange={(ev) => editExpDate(i, "endDate", ev.target.value)} className="h-7 w-28 text-xs" />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <SimpleList title="Education" items={stage.data.education.map((e) => `${e.qualification} — ${e.institution}`)} prefix="edu" excluded={stage.excluded} onToggle={toggle} />
            <SimpleList title="Certifications" items={stage.data.certifications.map((c) => c.name)} prefix="cert" excluded={stage.excluded} onToggle={toggle} />
            <SimpleList title="Skills" items={stage.data.skills.map((s) => s.name)} prefix="skill" excluded={stage.excluded} onToggle={toggle} />

            <DialogFooter>
              <Button onClick={onCommit}>Import selected</Button>
            </DialogFooter>
          </div>
        )}

        {stage.name === "committing" && <p className="text-sm">Saving…</p>}

        {stage.name === "done" && (
          <div className="space-y-3">
            <p className="text-sm">
              Imported {stage.result.created.experiences} experiences, {stage.result.created.education} education,
              {" "}{stage.result.created.certifications} certifications, {stage.result.created.skills} skills,
              and filled {stage.result.created.contactFields} contact fields.
            </p>
            {stage.result.skipped.length > 0 && (
              <div className="text-sm text-muted-foreground">
                <p className="font-medium">Skipped:</p>
                <ul className="list-disc pl-5">
                  {stage.result.skipped.map((s, i) => <li key={i}>{s.label} — {s.reason}</li>)}
                </ul>
              </div>
            )}
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const EXTRACTION_STEPS = [
  'Reading PDF…',
  'Identifying experience and skills…',
  'Structuring your profile…',
  'Almost there…',
]
const STEP_VALUES = [20, 45, 68, 85]

function ExtractionProgress() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStep(s => Math.min(s + 1, EXTRACTION_STEPS.length - 1)), 3500)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-3 py-2">
      <Progress value={STEP_VALUES[step]} />
      <p className="text-sm text-muted-foreground">{EXTRACTION_STEPS[step]}</p>
    </div>
  )
}

function SimpleList({ title, items, prefix, excluded, onToggle }: {
  title: string; items: string[]; prefix: string; excluded: Set<string>; onToggle: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title} ({items.length})</h3>
      {items.map((label, i) => {
        const key = `${prefix}-${i}`
        return (
          <label key={key} className="flex items-center gap-2 border-b py-1.5 text-sm">
            <Checkbox checked={!excluded.has(key)} onCheckedChange={() => onToggle(key)} />
            <span>{label}</span>
          </label>
        )
      })}
    </div>
  )
}
