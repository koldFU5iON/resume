// Robust parsing of JSON embedded in raw LLM output.
//
// Models frequently wrap JSON in ```json code fences or pad it with prose; a
// bare JSON.parse fails on both. This helper strips the noise and never throws
// — callers inspect the tagged result instead of catching SyntaxErrors.

import type { z } from 'zod'

export type ExtractJSONResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'no_json' | 'parse' | 'schema'; error: unknown }

function extractJSONText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Whole output is already JSON — fastest path.
  if (trimmed[0] === '{' || trimmed[0] === '[') return trimmed

  // Code fence: ```json ... ``` or ``` ... ```, with optional prose around it.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    const inner = fenceMatch[1].trim()
    if (inner[0] === '{' || inner[0] === '[') return inner
  }

  // First balanced {…} / […] block. Strings are scanned so braces inside JSON
  // string values don't throw off the depth counter.
  const firstObject = trimmed.indexOf('{')
  const firstArray = trimmed.indexOf('[')
  const start =
    firstObject === -1
      ? firstArray
      : firstArray === -1
        ? firstObject
        : Math.min(firstObject, firstArray)
  if (start === -1) return null

  const open = trimmed[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return trimmed.slice(start, i + 1)
    }
  }
  return null
}

export function extractJSON<T>(text: string, schema?: z.ZodType<T>): ExtractJSONResult<T> {
  const raw = extractJSONText(text)
  if (raw === null) {
    return { ok: false, reason: 'no_json', error: new Error('No JSON object or array found in LLM output.') }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'parse', error: err }
  }

  if (!schema) return { ok: true, value: value as T }

  const parsed = schema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'schema', error: parsed.error }
  return { ok: true, value: parsed.data }
}
