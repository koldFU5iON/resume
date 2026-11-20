export const STOPWORDS = new Set(['with', 'that', 'this', 'from', 'have', 'been', 'were', 'into', 'over', 'about', 'across', 'which', 'while', 'their', 'than', 'then', 'them', 'they', 'also', 'more', 'each', 'when', 'after', 'before'])

export const SMALL_WORDS = new Set(['the', 'and', 'for', 'of', 'to', 'in', 'on', 'at', 'an'])
/** Content words plus any digit, however short ("2" and "0" of "2.0"): names that differ by a number stay different. */
const nameTokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && (/\d/.test(w) || (w.length > 1 && !STOPWORDS.has(w) && !SMALL_WORDS.has(w)))))

/** Suggest the most specific named project among the selected role's available labels. */
export function mentionedProject<T extends { name: string }>(text: string, projects: readonly T[]): T | undefined {
  const words = nameTokens(text)
  return projects
    .map(project => ({ project, name: nameTokens(project.name) }))
    .filter(({ name }) => name.size > 0 && [...name].every(word => words.has(word)))
    .sort((a, b) => b.name.size - a.name.size)[0]?.project
}
