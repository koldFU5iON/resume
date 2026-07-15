export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "link"; value: string; href: string }

const INLINE_PATTERN =
  /\*\*(.+?)\*\*|\*(.+?)\*|([\w.+-]+@[\w-]+\.[\w.-]+)|(https?:\/\/\S+)/g

// Renders **bold**, *italic*, and bare emails/URLs into styled runs for
// surfaces (like react-pdf) that don't have a markdown renderer available.
export function parseInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) })
    }

    const [full, bold, italic, email, url] = match
    if (bold !== undefined) {
      tokens.push({ type: "bold", value: bold })
    } else if (italic !== undefined) {
      tokens.push({ type: "italic", value: italic })
    } else if (email !== undefined) {
      tokens.push({ type: "link", value: email, href: `mailto:${email}` })
    } else if (url !== undefined) {
      tokens.push({ type: "link", value: url, href: url })
    }

    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) })
  }

  return tokens
}
