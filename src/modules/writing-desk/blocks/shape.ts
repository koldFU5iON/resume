import type { List, ListItem } from "mdast"
import type { WritingDeskContent } from "./types"

/**
 * A list item is "simple" when it holds exactly one paragraph and nothing else
 * (no nested lists, no extra paragraphs). Inline/compact renderers can only
 * flatten simple items without losing content, so anything more complex must
 * fall back to ordinary Markdown rendering.
 */
function isSimpleListItem(item: ListItem): boolean {
  return item.children.length === 1 && item.children[0]?.type === "paragraph"
}

function isSimpleList(list: List): boolean {
  return list.children.length > 0 && list.children.every(isSimpleListItem)
}

/**
 * True when the block can use list layout: every list is simple and the only
 * other content is headings, which render normally above or between lists.
 * This lets a block like `:::inline-list` include its own section heading.
 */
export function isListLayoutBlock(children: WritingDeskContent[]): boolean {
  return (
    children.length > 0 &&
    children.some(child => child.type === "list") &&
    children.every(child => child.type === "list" ? isSimpleList(child) : child.type === "heading")
  )
}

/**
 * A list item's inline content, or null when the item is not simple. Renderers
 * should treat a null result as "fall back to Markdown".
 */
export function simpleListItemInline(item: ListItem) {
  if (!isSimpleListItem(item)) return null
  const paragraph = item.children[0]
  return paragraph.type === "paragraph" ? paragraph.children : null
}
