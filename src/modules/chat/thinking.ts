export function splitThinkingContent(text: string): {
  content: string
  isThinking: boolean
} {
  const lower = text.toLowerCase()
  const openTag = '<thinking>'
  const closeTag = '</thinking>'
  let content = ''
  let cursor = 0

  while (true) {
    const opening = lower.indexOf(openTag, cursor)
    if (opening === -1) {
      return { content: content + text.slice(cursor), isThinking: false }
    }

    content += text.slice(cursor, opening)
    const closing = lower.indexOf(closeTag, opening + openTag.length)
    if (closing === -1) {
      return { content, isThinking: true }
    }

    cursor = closing + closeTag.length
  }
}
