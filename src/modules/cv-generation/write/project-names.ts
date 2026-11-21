import { distinctiveTokens, normalised, projectFiguresReflected, type FigureName } from './checks'

export const projectDisplayName = (name: string): string => name.trim().replace(/^(?!(?:19|20)\d{2}[.)])\d+[.)]\s+/, '')

const trailingAcronym = /\s+\(([\p{Lu}][\p{Lu}\d]{1,9})\)$/u
const trailingYear = /\s+((?:19|20)\d{2})$/
const edition = /^(?:\d+|v\d+)$/
const romanEdition = /^[IVXLCDM]+$/
const measurementUnit = /^(?:km|cm|mm|m|kg|mg|g|ms|s|seconds?|minutes?|hours?|days?|weeks?|months?|years?|percent)$/i
const editionLabel = /^(?:v|version|release|edition|phase|series|part|volume|vol|mark|mk)$/
const editionSuffix = /(?:\s*-\s*|\s+)(?:(?:[Vv]ersion|[Rr]elease|[Ee]dition|[Pp]hase|[Ss]eries|[Pp]art|[Vv]ol(?:ume)?|[Mm]ark|[Mm]k)\s+)?\(?(?:[vV]?\d+(?:\.\d+)*|[IVXLCDM]+)\)?$/
const trailingDescriptor = /\s+(?:(?:(?:press|launch) )?(?:event|campaign)|programme|program|project|initiative|demo|launch)$/i

function shortenedTitle(name: string): string | undefined {
  const short = name.replace(trailingDescriptor, '')
  if (short !== name && distinctiveTokens(short).filter((w) => /\p{L}/u.test(w)).length >= 2) return short
}

/** Ignore numeric title parts only inside a recognized name or alias. */
export function projectFigureNames(name: string, peers: readonly string[]): FigureName[] {
  const display = projectDisplayName(name)
  if (!/\d/.test(display)) return []
  const expanded = display.replace(trailingAcronym, '')
  const mask = (text: string) => {
    if (!/\d/.test(text)) return text
    if (conflictingProjectEdition(text, name, peers)) return text
    const mentions = rawProjectMentions(text, name, peers)
    if (mentions.length === 0) return text
    const letters = text.split('')
    for (const { start, end } of mentions) {
      if (/\d/.test(text.slice(start, end))) letters.fill(' ', start, end)
    }
    return letters.join('')
  }
  return [mask, ...new Set([display, expanded])]
}

type Alias = { words: string[]; full: boolean; exactCase?: string; spelling?: string }

function aliases(name: string): Alias[] {
  const display = projectDisplayName(name)
  const words = normalised(display)
  if (!words.length || (!distinctiveTokens(display).length && !words.some((w) => /\d/.test(w)))) return []
  const out: Alias[] = [{ words, full: true, spelling: display }]
  const acronym = display.match(trailingAcronym)?.[1]
  const expanded = acronym ? display.replace(trailingAcronym, '') : display
  const base = expanded.replace(trailingYear, '')
  if (acronym) out.push({ words: normalised(expanded), full: false, spelling: expanded })
  if (base !== expanded && normalised(base).length >= 2) out.push({ words: normalised(base), full: false })
  const shortTitle = shortenedTitle(expanded)
  if (shortTitle) out.push({ words: normalised(shortTitle), full: false, spelling: shortTitle })
  // Keep qualifiers such as Phase 2 intact. Only omit generic name words.
  const baseWords = normalised(base)
  if (!baseWords.some((w) => /\d/.test(w)) && !base.split(/[^\p{L}\p{N}]+/u).some((w) => romanEdition.test(w))) {
    const short = distinctiveTokens(base)
    if (short.length >= 2) out.push({ words: short, full: false })
    // For a name with only one distinctive word, retain a second word of the saved name.
    if (short.length === 1 && baseWords.length >= 3 && baseWords.includes(short[0])) {
      for (let i = 0; i < baseWords.length - 1; i++) {
        const part = baseWords.slice(i, i + 2)
        if (part.includes(short[0])) out.push({ words: part, full: false })
      }
    }
    if (acronym) return [...out, { words: normalised(acronym), full: false, exactCase: acronym }]
  }
  return out
}

const containsAt = (words: readonly string[], part: readonly string[], i: number) =>
  part.every((w, j) => words[i + j] === w)

const dottedPart = (text: string) => [...text.matchAll(/\d(?:\.\d+)+/g)].map(([part]) => part).join(' ')

function rawProjectMentions(text: string, name: string, peers: readonly string[], requireDifferentEdition = false, fullOnly = false) {
  const tokens = [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)]
    .flatMap((match) => normalised(match[0]).map((word) => ({ match, word })))
  const surface = tokens.map((token) => token.match)
  const words = tokens.map((token) => token.word)
  const display = projectDisplayName(name)
  const otherNames = peers.filter((peer) => peer !== name).map((peer) => normalised(projectDisplayName(peer)))
  const mentions: Array<{ index: number; start: number; end: number }> = []
  for (const candidate of aliases(name)) {
    const { words: part, full, exactCase, spelling } = candidate
    const dotted = spelling && dottedPart(spelling)
    if (fullOnly && !full) continue
    // A short name shared with another project cannot identify which project it is.
    if (!full && otherNames.some((other) => {
      const distinctive = distinctiveTokens(other.join(' '))
      return other.some((_, i) => containsAt(other, part, i)) ||
        distinctive.some((_, i) => containsAt(distinctive, part, i))
    })) continue
    const matchesAt = (i: number) => {
      if (!containsAt(words, part, i) || (exactCase && surface[i]?.[0] !== exactCase)) return false
      const end = i + part.length
      const next = words[end] ?? ''
      const last = surface[end - 1]
      const gap = last && surface[end] ? text.slice(last.index + last[0].length, surface[end].index) : ''
      if (dotted && dottedPart(text.slice(surface[i]?.index, last.index + last[0].length)) !== dotted) return false
      const isEdition = (n: number) => {
        // A quantity after a title is not a new edition: 'Canal Survey 2 km upstream'.
        if (/^\d+$/.test(words[n] ?? '') && (measurementUnit.test(words[n + 1] ?? '') || /^\s*%/.test(text.slice((surface[n]?.index ?? 0) + (surface[n]?.[0].length ?? 0))))) return false
        return edition.test(words[n] ?? '') || romanEdition.test(surface[n]?.[0] ?? '')
      }
      if (full && part.length === 1 && !/\d/.test(part[0])) {
        if (surface[i]?.[0] !== display) return false
        // An ordinary word needs a title cue when its casing cannot identify it.
        const heading = i === 0 && (!surface[end] || /[:(—–-]/.test(gap))
        const parenthetical = /\(\s*$/.test(text.slice(0, surface[i].index))
        if (!heading && !parenthetical && (i === 0 || !/\p{Lu}/u.test(display))) return false
      }
      const explicitEdition = /^\s*[-–—]?\s*\(?\s*$/.test(gap) && (isEdition(end) || (editionLabel.test(next) && isEdition(end + 1)))
      const dottedEdition = gap === '.' && edition.test(words[end - 1]) && edition.test(next)
      if (requireDifferentEdition) return explicitEdition || dottedEdition
      if (explicitEdition || dottedEdition) return false
      // An exact short name can also be the opening words of a longer, distinct project.
      return !otherNames.some((other) => other.length > part.length &&
        other.some((_, offset) => containsAt(other, part, offset) && i >= offset && containsAt(words, other, i - offset)))
    }
    words.forEach((_, index) => {
      if (!matchesAt(index)) return
      const last = surface[index + part.length - 1]
      mentions.push({ index, start: surface[index].index, end: last.index + last[0].length })
    })
  }
  return mentions
}

/** The first identifying mention, by word index, with the employer's other project names for disambiguation. */
function rawProjectMention(text: string, name: string, peers: readonly string[], requireDifferentEdition = false, fullOnly = false): number {
  const mentions = rawProjectMentions(text, name, peers, requireDifferentEdition, fullOnly)
  return mentions.length > 0 ? Math.min(...mentions.map((mention) => mention.index)) : -1
}

export function projectMention(text: string, name: string, peers: readonly string[]): number {
  return conflictingProjectEdition(text, name, peers) ? -1 : rawProjectMention(text, name, peers)
}

export const namesProject = (text: string, name: string, peers: readonly string[]): boolean =>
  projectMention(text, name, peers) >= 0

export function conflictingProjectEdition(text: string, name: string, peers: readonly string[]): boolean {
  const expanded = projectDisplayName(name).replace(trailingAcronym, '')
  // An acronym cannot overrule an explicitly different edition of the expanded name.
  if (rawProjectMention(text, expanded, peers, false, true) >= 0) return false
  if (rawProjectMention(text, expanded, peers, true, true) >= 0) return true
  const short = shortenedTitle(expanded)
  if (short && rawProjectMention(text, short, peers, false, true) >= 0) return false
  const base = (short ?? expanded).replace(editionSuffix, '')
  return rawProjectMention(text, base, peers, true) >= 0
}

/** A selected project's own figure can establish coverage independently of naming it. */
export function selectedProjectReflected(lines: readonly string[], project: { name: string; text?: string }, peers: readonly string[]): boolean {
  return lines.some((line) => namesProject(line, project.name, peers)) ||
    projectFiguresReflected(lines, project.text, projectFigureNames(project.name, peers))
}
