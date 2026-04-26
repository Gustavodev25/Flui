import React from 'react'

function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let remaining = text
  let idx = 0

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(<strong key={`${keyPrefix}-b${idx++}`} className="font-semibold text-[#202020]">{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }
    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/)
    if (italicMatch) {
      parts.push(<em key={`${keyPrefix}-i${idx++}`} className="italic">{italicMatch[1]}</em>)
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }
    // Inline code
    const codeMatch = remaining.match(/^`(.+?)`/)
    if (codeMatch) {
      parts.push(
        <code key={`${keyPrefix}-c${idx++}`} className="bg-[#f0f0ee] border border-[#e9e9e7] px-1.5 py-0.5 rounded text-[0.8em] font-mono text-[#37352f]">
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }
    // Link
    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/)
    if (linkMatch) {
      parts.push(
        <a key={`${keyPrefix}-l${idx++}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
          className="text-[#202020] underline underline-offset-2 hover:opacity-60 transition-opacity">
          {linkMatch[1]}
        </a>
      )
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }
    // Advance to next special token
    const nextSpecial = remaining.search(/\*\*|\*|`|\[/)
    if (nextSpecial === -1) {
      parts.push(remaining)
      break
    } else if (nextSpecial === 0) {
      parts.push(remaining[0])
      remaining = remaining.slice(1)
    } else {
      parts.push(remaining.slice(0, nextSpecial))
      remaining = remaining.slice(nextSpecial)
    }
  }

  return parts
}

function parseMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Standalone image: ![alt](url)
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imgMatch) {
      nodes.push(
        <img key={key++} src={imgMatch[2]} alt={imgMatch[1]}
          className="rounded-xl max-w-full border border-[#e9e9e7] my-3 shadow-sm" />
      )
      i++
      continue
    }

    // H2
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={key++} className="text-base font-bold text-[#202020] mt-5 mb-1.5 tracking-tight">
          {parseInline(line.slice(3), `h2-${key}`)}
        </h2>
      )
      i++
      continue
    }

    // H3
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={key++} className="text-sm font-semibold text-[#202020] mt-3 mb-1">
          {parseInline(line.slice(4), `h3-${key}`)}
        </h3>
      )
      i++
      continue
    }

    // Horizontal rule
    if (line.trim() === '---') {
      nodes.push(<hr key={key++} className="border-[#e9e9e7] my-4" />)
      i++
      continue
    }

    // Unordered list — collect consecutive items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: React.ReactNode[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(
          <li key={i} className="leading-relaxed">
            {parseInline(lines[i].slice(2), `ul-${i}`)}
          </li>
        )
        i++
      }
      nodes.push(
        <ul key={key++} className="list-disc list-outside ml-4 space-y-0.5 my-2 text-[#37352f]/60 text-sm">
          {items}
        </ul>
      )
      continue
    }

    // Ordered list — collect consecutive items
    if (/^\d+\. /.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(
          <li key={i} className="leading-relaxed">
            {parseInline(lines[i].replace(/^\d+\. /, ''), `ol-${i}`)}
          </li>
        )
        i++
      }
      nodes.push(
        <ol key={key++} className="list-decimal list-outside ml-4 space-y-0.5 my-2 text-[#37352f]/60 text-sm">
          {items}
        </ol>
      )
      continue
    }

    // Empty line — small spacer
    if (line.trim() === '') {
      nodes.push(<div key={key++} className="h-1" />)
      i++
      continue
    }

    // Paragraph
    nodes.push(
      <p key={key++} className="text-sm text-[#37352f]/50 leading-relaxed">
        {parseInline(line, `p-${key}`)}
      </p>
    )
    i++
  }

  return nodes
}

interface MarkdownRendererProps {
  content: string
  className?: string
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return <div className={className}>{parseMarkdown(content)}</div>
}
