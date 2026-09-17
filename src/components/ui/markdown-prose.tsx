'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const components: Components = {
  // Remap heading levels so markdown h1/h2 can't override the page h1
  h1: ({ children }) => <h3 className="text-base font-semibold mt-5 mb-2 text-foreground">{children}</h3>,
  h2: ({ children }) => <h4 className="text-sm font-semibold mt-4 mb-1.5 text-foreground">{children}</h4>,
  h3: ({ children }) => <h5 className="text-sm font-medium mt-3 mb-1 text-foreground">{children}</h5>,
  p: ({ children }) => <p className="text-sm leading-relaxed mb-3 text-foreground last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-4 text-muted-foreground italic my-3">
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }) => (
    <code
      className={`bg-muted px-1.5 py-0.5 rounded text-xs font-mono ${className ?? ''}`}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted rounded-lg p-4 my-3 overflow-x-auto text-xs font-mono">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border my-4" />,
}

export function MarkdownProse({ content }: { content: string }) {
  return (
    <div className="prose dark:prose-invert max-w-[72ch]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
