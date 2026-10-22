"use client"

import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"
import { remarkWritingDeskPreview } from "@/modules/writing-desk/blocks/preview"
import { profileForDocumentType } from "@/modules/writing-desk/blocks/types"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"

type BlockNode = {
  properties?: Record<string, unknown>
}

function property(node: BlockNode | undefined, key: string): string | undefined {
  const value = node?.properties?.[key]
  return typeof value === "string" ? value : undefined
}

function BlockWrapper({ node, children }: { node?: BlockNode; children?: ReactNode }) {
  const blockId = property(node, "data-wd-block")
  const message = property(node, "data-wd-message")

  if (!blockId) return <div>{children}</div>

  const invalid = property(node, "data-wd-valid") === "false"
  const styles: Record<string, string> = {
    header: "mb-7 border-b border-border pb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:mt-1 [&_h2]:text-base [&_h2]:font-medium [&_h3]:mt-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-muted-foreground [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground",
    skills: "[&_p]:text-sm [&_p]:leading-relaxed",
    "inline-list": "[&_p]:text-sm [&_p]:leading-relaxed",
    "compact-list": "[&_ul]:my-2 [&_ul]:space-y-0.5 [&_ul]:pl-5 [&_li]:my-0 [&_li]:text-sm [&_li]:leading-snug [&_p]:my-0",
  }

  return (
    <div className={styles[blockId] ?? ""}>
      {invalid && message ? (
        <p className="mb-2 rounded-md border border-dashed border-amber-500/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {message}
        </p>
      ) : null}
      {children}
    </div>
  )
}

const components: Components = {
  div: ({ node, children }) => <BlockWrapper node={node}>{children}</BlockWrapper>,
}

export function WritingDeskPreview({
  markdown,
  documentType,
}: {
  markdown: string
  documentType: WritingDeskDocumentType | null
}) {
  const profile = profileForDocumentType(documentType)
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none"
      data-writing-desk-profile={profile}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkWritingDeskPreview]}
        components={components}
      >
        {markdown || "*No content yet.*"}
      </ReactMarkdown>
    </div>
  )
}
