import type { Root, Parent, Text } from "mdast"
import type { VFile } from "vfile"
import { visit, SKIP } from "unist-util-visit"

type OffsetNode = {
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

/**
 * Writing Desk only supports container directives (`:::name`). `remark-directive`
 * also enables `textDirective` (`:name`) and `leafDirective` (`::name`), which
 * our renderers don't understand — leaving them as-is would silently drop text
 * such as times (`10:30`) or ratios (`3:1`).
 *
 * This plugin replaces every inline/leaf directive with a plain `text` node
 * containing its original source, so the content survives in plain text, PDF
 * and preview output. It must run immediately after `remark-directive`.
 */
export function remarkPreserveDirectives() {
  return (tree: Root, file: VFile) => {
    const source = typeof file.value === "string" ? file.value : String(file.value)

    visit(tree, (node, index, parent) => {
      const type = (node as { type: string }).type
      if (type !== "textDirective" && type !== "leafDirective") return
      if (index === undefined || !parent) return

      const offset = node as OffsetNode
      const start = offset.position?.start?.offset
      const end = offset.position?.end?.offset
      const original =
        typeof start === "number" && typeof end === "number"
          ? source.slice(start, end)
          : `:${(node as { name?: string }).name ?? ""}`

      ;(parent as Parent).children[index] = {
        type: "text",
        value: original,
      } as Text

      // Skip the replaced node; it has no directive children to visit.
      return [SKIP, index]
    })
  }
}
