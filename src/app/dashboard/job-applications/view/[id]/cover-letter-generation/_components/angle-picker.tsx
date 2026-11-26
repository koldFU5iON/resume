"use client"

import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, Loader2, RefreshCw, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LENGTHS, TONES, TONE_LABELS, type LetterLength, type QuestionTopic, type StoredAngles, type Tone } from "@/modules/cover-letter-generation/schema"
import { writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import {
  CUSTOM_ANGLE_MIN,
  choiceFromState,
  initialAnswers,
  isReusable,
  lengthLabel,
  requestCoverLetterAngles,
  submitCoverLetterChoice,
  type PickerState,
} from "@/app/dashboard/job-applications/_components/cover-letter-view"

const card = "rounded-lg border bg-background p-4 text-left transition-colors"
const selectedCard = "border-foreground ring-1 ring-foreground"

/**
 * "How would you like to angle this cover letter?" (#471). The suggested
 * angles as choosable cards plus "Write my own", the personal questions
 * (remembered answers pre-filled for reusable topics), tone and length
 * (starting from the owner's last choice), and whether to remember them.
 * Submitting starts the write phase; the page then shows its progress.
 */
export function AnglePicker({
  jobId,
  runId,
  angles,
  defaults,
}: {
  jobId: string
  runId: string
  angles: StoredAngles
  defaults: { tone: Tone; length: LetterLength; answers: Partial<Record<QuestionTopic, string>> }
}) {
  const router = useRouter()
  const ids = useId()
  const [state, setState] = useState<PickerState>({
    angle: null,
    customAngle: "",
    answers: initialAnswers(angles.questions, defaults.answers),
    tone: defaults.tone,
    length: defaults.length,
    remember: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"write" | "fresh" | null>(null)
  const [waitingDraft, setWaitingDraft] = useState<string | null>(null)
  const inFlight = useRef(false)
  const set = (patch: Partial<PickerState>) => { setError(null); setState(s => ({ ...s, ...patch })) }

  async function write() {
    const built = choiceFromState(state, angles.questions)
    if (!built.ok) { setError(built.message); return }
    if (inFlight.current) return
    inFlight.current = true
    setBusy("write")
    try {
      const outcome = await submitCoverLetterChoice(jobId, runId, built.choice)
      if (outcome.kind === "started") router.refresh()
      else if (outcome.kind === "draft_exists") setWaitingDraft(outcome.documentId ?? "")
      else if (outcome.kind === "not_waiting") { toast.info(outcome.message); router.refresh() }
      else setError(outcome.message)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function freshAngles() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy("fresh")
    try {
      const outcome = await requestCoverLetterAngles(jobId, { fresh: true })
      if (outcome.kind === "started") router.refresh()
      else if (outcome.kind === "draft_exists") setWaitingDraft(outcome.documentId ?? "")
      else setError(outcome.message)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  return (
    <form
      className="space-y-8"
      onSubmit={event => { event.preventDefault(); void write() }}
      aria-describedby={`${ids}-intro`}
    >
      <div>
        <h2 className="text-lg font-semibold">How would you like to angle this cover letter?</h2>
        <p id={`${ids}-intro`} className="mt-1 text-sm text-muted-foreground">
          Pick one of these, or write your own. The letter leads with this argument and uses the stories it names.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="sr-only">Angle</legend>
        {angles.angles.map((a, i) => {
          const selected = state.angle === i
          return (
            <label key={i} className={cn(card, "block cursor-pointer hover:bg-muted/40", selected && selectedCard)}>
              <span className="flex items-start gap-3">
                <input type="radio" name={`${ids}-angle`} checked={selected} onChange={() => set({ angle: i })} className="mt-1" />
                <span className="min-w-0 space-y-2">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block text-sm">{a.pitch}</span>
                  <span className="block text-sm text-muted-foreground"><span className="font-medium text-foreground">Opens with: </span><em>{a.hook}</em></span>
                  <span className="block text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Stories: </span>
                    {a.proofPoints.map(p => p.evidence).join("; ")}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Why them: </span>{a.whyThem.fact}{" "}
                    {!a.whyThemVerified && (
                      <Badge variant="warning" className="ml-1 gap-1 align-middle"><CircleAlert aria-hidden="true" />Check this</Badge>
                    )}
                  </span>
                  {a.playsDown && <span className="block text-xs text-muted-foreground">Plays down: {a.playsDown}</span>}
                  <span className="block text-xs text-muted-foreground">Best when: {a.fit}</span>
                </span>
              </span>
            </label>
          )
        })}
        <label className={cn(card, "block cursor-pointer hover:bg-muted/40", state.angle === "custom" && selectedCard)}>
          <span className="flex items-start gap-3">
            <input type="radio" name={`${ids}-angle`} checked={state.angle === "custom"} onChange={() => set({ angle: "custom" })} className="mt-1" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block font-medium">Write my own angle</span>
              <textarea
                aria-label="Your angle"
                value={state.customAngle}
                onFocus={() => set({ angle: "custom" })}
                onChange={event => set({ angle: "custom", customAngle: event.target.value })}
                rows={3}
                maxLength={600}
                placeholder="In a sentence or two: the argument you want this letter to make, and the story that proves it."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {state.angle === "custom" && state.customAngle.trim().length < CUSTOM_ANGLE_MIN && (
                <span className="block text-xs text-muted-foreground">A sentence or two is enough.</span>
              )}
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Make it yours <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Your answers are the only personal things the letter says. Skip any you like: the letter then stays professional and invents nothing about you.
        </p>
        {angles.questions.map((q, i) => (
          <div key={i} className="grid gap-1.5">
            <label htmlFor={`${ids}-q${i}`} className="text-sm font-medium">{q.question}</label>
            <textarea
              id={`${ids}-q${i}`}
              value={state.answers[i] ?? ""}
              onChange={event => set({ answers: state.answers.map((v, j) => (j === i ? event.target.value : v)) })}
              rows={2}
              maxLength={800}
              aria-describedby={`${ids}-q${i}-hint`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p id={`${ids}-q${i}-hint`} className="text-xs text-muted-foreground">
              {isReusable(q.topic) ? "Can be remembered for your next letters." : "Only used for this letter."}
            </p>
          </div>
        ))}
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-base font-semibold">Tone</legend>
          {TONES.map(t => (
            <label key={t} className={cn(card, "flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/40", state.tone === t && selectedCard)}>
              <input type="radio" name={`${ids}-tone`} checked={state.tone === t} onChange={() => set({ tone: t })} className="mt-1" />
              <span className="space-y-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {TONE_LABELS[t].label}
                  {angles.suggestedTone === t && <Badge variant="secondary" title={angles.toneReason}>Suggested for this company</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">{TONE_LABELS[t].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-base font-semibold">Length</legend>
          {LENGTHS.map(l => (
            <label key={l} className={cn(card, "flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40", state.length === l && selectedCard)}>
              <input type="radio" name={`${ids}-length`} checked={state.length === l} onChange={() => set({ length: l })} />
              <span className="text-sm">{lengthLabel(l)}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={state.remember} onChange={event => set({ remember: event.target.checked })} className="mt-1" />
        <span>Remember my tone, length and answers to &ldquo;why now&rdquo; and &ldquo;what I want next&rdquo; for my next letters.</span>
      </label>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {waitingDraft !== null && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p>A cover letter draft is already waiting for this job. Accept or discard it first; nothing was spent.</p>
          {waitingDraft && (
            <Button type="button" variant="outline" size="sm" onClick={() => router.push(writingDeskDocumentHref(jobId, waitingDraft))}>Open draft</Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="gap-1.5" disabled={busy !== null}>
          {busy === "write" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
          {busy === "write" ? "Starting…" : "Write my cover letter"}
        </Button>
        <Button type="button" variant="ghost" className="gap-1.5" onClick={() => void freshAngles()} disabled={busy !== null}>
          {busy === "fresh" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
          Suggest different angles
        </Button>
      </div>
    </form>
  )
}
