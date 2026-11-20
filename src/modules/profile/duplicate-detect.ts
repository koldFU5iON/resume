export function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Ignore a leading first-person subject so older verb-led evidence still matches.
export function normalizeClaim(text: string) {
  return text.toLowerCase().replace(/^\s*i\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

export function findAchievementMatch<T extends { description: string }>(description: string, existing: T[]): T | undefined {
  const text = normalizeClaim(description)
  const exact = existing.find((item) => normalizeClaim(item.description) === text)
  if (exact || !text) return exact
  const tokens = new Set(text.split(' '))
  let best: T | undefined
  let score = 0.5
  for (const item of existing) {
    const other = new Set(normalizeClaim(item.description).split(' '))
    const shared = [...tokens].filter((token) => other.has(token)).length
    const overlap = shared / (tokens.size + other.size - shared)
    if (overlap > score || (overlap === score && !best)) {
      best = item
      score = overlap
    }
  }
  return best
}

export function findSkillMatch<T extends { name: string }>(name: string, existing: T[]): T | undefined {
  return existing.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase())
}
