// Markdown to HTML and to plain text, for what Claude writes in a draft:
// paragraphs, headings, emphasis, links, lists, quotes, tables and code.
// A single newline is a line break, as in an email ("Saludos,\nAna").

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; isOrdered: boolean; start: number; items: string[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const FENCE = /^\s{0,3}(```|~~~)/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')

  return trimmed.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

function isBlockStart(line: string, nextLine: string | undefined): boolean {
  return (
    HEADING.test(line) ||
    RULE.test(line) ||
    FENCE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    (line.includes('|') && nextLine !== undefined && TABLE_RULE.test(nextLine))
  )
}

export function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const at = (n: number): string => lines[n] ?? ''
  const isEnd = (n: number) => n >= lines.length
  const blocks: Block[] = []
  let i = 0

  while (!isEnd(i)) {
    const line = at(i)

    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = line.match(FENCE)?.[1]
    if (fence !== undefined) {
      const body: string[] = []
      i += 1
      while (!isEnd(i) && !at(i).trim().startsWith(fence)) {
        body.push(at(i))
        i += 1
      }
      i += 1
      blocks.push({ kind: 'code', lines: body })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i += 1
      continue
    }

    if (line.includes('|') && !isEnd(i + 1) && TABLE_RULE.test(at(i + 1))) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (!isEnd(i) && at(i).includes('|') && at(i).trim() !== '') {
        rows.push(cells(at(i)))
        i += 1
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (!isEnd(i) && QUOTE.test(at(i))) {
        inner.push(at(i).match(QUOTE)?.[1] ?? '')
        i += 1
      }
      blocks.push({ kind: 'quote', blocks: parse(inner.join('\n')) })
      continue
    }

    const bullet = line.match(BULLET)
    const numbered = line.match(NUMBERED)
    if (bullet || numbered) {
      const isOrdered = !bullet
      const pattern = isOrdered ? NUMBERED : BULLET
      const indent = ((bullet ?? numbered)?.[1] ?? '').length
      const items: string[][] = []
      while (!isEnd(i)) {
        const next = at(i)
        const item = next.match(pattern)
        const last = items[items.length - 1]
        if (item && (item[1] ?? '').length <= indent) {
          items.push([item[3] ?? ''])
        } else if (next.trim() !== '' && last !== undefined && /^\s+/.test(next)) {
          // An indented line continues the item above (or holds a sublist).
          last.push(next.slice(Math.min(indent + 2, next.search(/\S/))))
        } else {
          break
        }
        i += 1
      }
      const start = isOrdered ? Number(numbered?.[2] ?? 1) : 1
      blocks.push({ kind: 'list', isOrdered, start, items })
      continue
    }

    const paragraph: string[] = []
    while (!isEnd(i) && at(i).trim() !== '' && (paragraph.length === 0 || !isBlockStart(at(i), lines[i + 1]))) {
      paragraph.push(at(i).trim())
      i += 1
    }
    blocks.push({ kind: 'paragraph', lines: paragraph })
  }

  return blocks
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Inline spans. Code spans and links are cut out first, so emphasis
// markers inside them stay as written.
export function inlineHtml(text: string): string {
  const held: string[] = []
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`

  let out = text
    .replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, href: string) =>
      hold(`<a href="${escapeHtml(href)}">${inlineHtml(label)}</a>`),
    )
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, href: string) => hold(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (_, lead: string, href: string) =>
      lead + hold(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`),
    )

  out = escapeHtml(out)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')

  return out.replace(/\u0000(\d+)\u0000/g, (_, n: string) => held[Number(n)] ?? '')
}

const CELL = 'border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top'

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${inlineHtml(block.text)}</h${block.level}>`
    case 'paragraph':
      return `<p>${block.lines.map(inlineHtml).join('<br>')}</p>`
    case 'rule':
      return '<hr>'
    case 'code':
      return `<pre style="font-family:Menlo,Consolas,monospace;font-size:90%;background:#f6f8fa;padding:8px"><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`
    case 'quote':
      return `<blockquote style="margin:0 0 0 8px;padding-left:8px;border-left:3px solid #d0d7de;color:#57606a">${block.blocks.map(blockHtml).join('')}</blockquote>`
    case 'table': {
      const head = block.head.map(cell => `<th style="${CELL};background:#f6f8fa">${inlineHtml(cell)}</th>`).join('')
      const rows = block.rows
        .map(row => `<tr>${block.head.map((_, n) => `<td style="${CELL}">${inlineHtml(row[n] ?? '')}</td>`).join('')}</tr>`)
        .join('')

      return `<table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    }
    case 'list': {
      const tag = block.isOrdered ? 'ol' : 'ul'
      const start = block.isOrdered && block.start !== 1 ? ` start="${block.start}"` : ''
      const items = block.items
        .map(item => {
          const [first, ...rest] = item
          const nested = rest.length > 0 ? parse(rest.join('\n')).map(blockHtml).join('') : ''

          return `<li>${inlineHtml(first ?? '')}${nested}</li>`
        })
        .join('')

      return `<${tag}${start}>${items}</${tag}>`
    }
  }
}

export function toHtml(markdown: string): string {
  return parse(markdown).map(blockHtml).join('\n')
}

// A whole HTML document for the clipboard: the charset is declared, so
// accented letters survive the trip into a mail client.
export function htmlDocument(markdown: string): string {
  return (
    '<html><head><meta charset="utf-8"></head><body>' +
    `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45">${toHtml(markdown)}</div>` +
    '</body></html>'
  )
}

export function inlinePlain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, href: string) =>
      label === href ? href : `${inlinePlain(label)} (${href})`,
    )
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1$2')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1$2')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
}

function blockPlain(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return inlinePlain(block.text)
    case 'paragraph':
      return block.lines.map(inlinePlain).join('\n')
    case 'rule':
      return '----------'
    case 'code':
      return block.lines.join('\n')
    case 'quote':
      return block.blocks
        .map(blockPlain)
        .join('\n\n')
        .split('\n')
        .map(line => `> ${line}`.trimEnd())
        .join('\n')
    case 'table': {
      const rows = [block.head, ...block.rows].map(row => block.head.map((_, n) => inlinePlain(row[n] ?? '')))
      const widths = block.head.map((_, n) => Math.max(...rows.map(row => (row[n] ?? '').length)))
      const line = (row: string[]) => row.map((cell, n) => cell.padEnd(widths[n] ?? 0)).join('  ').trimEnd()

      return [line(rows[0] ?? []), widths.map(w => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line)].join('\n')
    }
    case 'list':
      return block.items
        .map((item, n) => {
          const marker = block.isOrdered ? `${block.start + n}. ` : '- '
          const [first, ...rest] = item
          const nested = rest.length > 0 ? '\n' + parse(rest.join('\n')).map(blockPlain).join('\n').replace(/^/gm, '   ') : ''

          return marker + inlinePlain(first ?? '') + nested
        })
        .join('\n')
  }
}

export function toPlain(markdown: string): string {
  return parse(markdown).map(blockPlain).join('\n\n')
}
