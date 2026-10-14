import { describe, expect, test } from 'claude-code/testing'

import { htmlDocument, toHtml, toPlain } from '../hooks/markdown'

const EMAIL = `Hola Begoña:

No falta nada. Los pagos de **Lucía** están en las transferencias del *13* y del 14 de octubre.

| Transferencia | Fecha | Importe |
| --- | --- | ---: |
| T-101 | 13 oct | 120,00 € |
| T-102 | 14 oct | 80,00 € |

- Ver [el panel](https://example.com/transferencias)
- Código \`T-101\`

Saludos,
Andrés`

describe('toHtml', () => {
  test('keeps the paragraphs and the line breaks of an email', () => {
    const html = toHtml(EMAIL)
    expect(html).toContain('<p>Hola Begoña:</p>')
    expect(html).toContain('<p>Saludos,<br>Andrés</p>')
  })

  test('draws emphasis, links, code and lists', () => {
    const html = toHtml(EMAIL)
    expect(html).toContain('<strong>Lucía</strong>')
    expect(html).toContain('<em>13</em>')
    expect(html).toContain('<li>Ver <a href="https://example.com/transferencias">el panel</a></li>')
    expect(html).toContain('<code>T-101</code>')
  })

  test('draws a table with a cell per column', () => {
    const html = toHtml(EMAIL)
    expect(html).toContain('<table')
    expect(html).toContain('>Importe</th>')
    expect(html).toContain('>80,00 €</td>')
  })

  test('escapes HTML that the text holds', () => {
    expect(toHtml('a <b> & c')).toBe('<p>a &lt;b&gt; &amp; c</p>')
  })

  test('links a bare URL and leaves the dot after it', () => {
    expect(toHtml('See https://example.com/a.')).toBe('<p>See <a href="https://example.com/a">https://example.com/a</a>.</p>')
  })

  test('does not read snake_case or a lone star as emphasis', () => {
    expect(toHtml('use po_id_1 and 2 * 3')).toBe('<p>use po_id_1 and 2 * 3</p>')
  })

  test('draws headings, quotes, rules, code fences and numbered lists', () => {
    const html = toHtml('# Title\n\n> quoted **text**\n\n---\n\n```\nx < 1\n```\n\n3. three\n4. four')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<blockquote')
    expect(html).toContain('<strong>text</strong>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<code>x &lt; 1</code>')
    expect(html).toContain('<ol start="3"><li>three</li><li>four</li></ol>')
  })

  test('declares the charset in the clipboard document', () => {
    expect(htmlDocument('Hola')).toContain('<meta charset="utf-8">')
  })
})

describe('toPlain', () => {
  test('drops the markers and keeps the text', () => {
    const plain = toPlain(EMAIL)
    expect(plain).toContain('Los pagos de Lucía están en las transferencias del 13 y del 14 de octubre.')
    expect(plain).toContain('- Ver el panel (https://example.com/transferencias)')
    expect(plain).toContain('- Código T-101')
    expect(plain).toContain('Saludos,\nAndrés')
  })

  test('lines up the columns of a table', () => {
    const plain = toPlain('| a | bb |\n|---|---|\n| ccc | d |')
    expect(plain).toBe('a    bb\n---  --\nccc  d')
  })
})
