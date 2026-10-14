import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Draft } from '../types'
import { copyRich } from './clipboard'
import { htmlDocument, toPlain } from './markdown'

const PANE = 'draft'
const TOOL = 'mcp__meatproxy__draft'
const COMMAND = 'draft'
// An email reads best at about 72 characters a line. The dock asks for
// that width, but never more than about 42% of the terminal, so the
// transcript keeps most of the screen.
const WIDTH = 76
const MIN_WIDTH = 48
const KEPT = 30
const STORE_KEY = 'drafts'

const drafts = atom({ plugin: 'meatproxy', key: 'drafts' } as const, [] as Draft[])
const shown = atom({ plugin: 'meatproxy', key: 'shown' } as const, -1)
const notice = atom({ plugin: 'meatproxy', key: 'notice' } as const, null as string | null)

const RULE = `# Drafts for other people (meatproxy)

When the user asks you to draft, write, prepare, answer, reword or translate a text that they will send to someone else (an email, a reply, a chat message, a ticket, a comment, a review, a post), call the ${TOOL} tool with that text. The tool shows the draft in a pane beside the conversation, where the user copies it as rich text, markdown or plain text with one key.

- Do not write the draft to a file. This holds also when the user asks for the draft "in an md file" or "in /tmp": that was their old way to get a draft they can copy, and the pane replaces it. Write a file as well only when they need the file itself, for example to attach it or to commit it.
- Do not repeat the draft in your reply. After the call, write one short line at most: an open question, or an assumption you made.
- Put only the text to send in \`body\`, as markdown. Put an email's subject in \`subject\` and the recipients in \`to\`, not in \`body\`.
- When the user asks for a change, call the tool again with the full new text.
- If the tool says that no pane is available, show the draft in your reply instead.`

// Words that mark a request for a text to send, in English and Spanish.
// A match adds a short reminder beside the prompt; the reminder itself
// says that it applies only to texts for another person.
const DRAFT_WORDS =
  /\b(draft|e-?mails?|mails?|reply|replies|respond|message|slack|teams|ticket|letter|borrador|correos?|respuesta|respond[ea]r?|contesta(r)?|mensajes?|redact[ae]r?|carta)\b|\bmd\b|\/tmp\b/i

const REMINDER = `meatproxy: If this prompt asks for a text that the user will send to another person (an email, a reply, a message, a ticket), show it with the ${TOOL} tool. Do not write it to a file, even if the prompt says "md file" or "/tmp": the Draft pane replaces that file. Plans, notes and documents that are not messages for another person are not drafts: handle them as usual.`

const DESCRIPTION = `Shows a draft that the user will send to someone else (an email, a reply, a chat message, a ticket, a comment) in a pane where they copy it as rich text, markdown or plain text. Use it every time you draft such a text, instead of writing it to a file or into your reply. Call it again with the full text for each new version.`

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description: 'The text to send, in markdown: greeting, body and sign-off. Not the subject.',
    },
    subject: {
      type: 'string',
      description: "The email's subject line, for example 'RE: Payouts of 13 October'. Leave it out for chat messages.",
    },
    to: {
      type: 'string',
      description: 'Who the text is for, for example "Begoña" or "#payments channel".',
    },
  },
  required: ['body'],
  additionalProperties: false,
}

type Format = 'rich' | 'md' | 'plain' | 'subject'

const LABELS: Record<Format, string> = {
  rich: 'rich text',
  md: 'markdown',
  plain: 'plain text',
  subject: 'the subject',
}

function current(list: readonly Draft[], at: number): { draft: Draft; index: number } | undefined {
  if (list.length === 0) {
    return undefined
  }
  const index = at < 0 || at >= list.length ? list.length - 1 : at
  const draft = list[index]

  return draft === undefined ? undefined : { draft, index }
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

async function say($: EngineInterface, text: string) {
  await update($, notice, () => text)
  $.clock.after(4000, () => {
    void update($, notice, now => (now === text ? null : now))
  })
}

async function copy($: EngineInterface, draft: Draft, format: Format, surface?: RenderSurface): Promise<string> {
  let reason: string | undefined

  if (format === 'rich') {
    const done = await copyRich($, htmlDocument(draft.body), toPlain(draft.body))
    reason = done.isCopied ? undefined : done.reason
  } else if (format === 'subject' && !draft.subject) {
    reason = 'this draft has no subject'
  } else {
    const text = format === 'md' ? draft.body : format === 'plain' ? toPlain(draft.body) : (draft.subject as string)
    const done = await $.ui.copy({ text, surface })
    reason = done.isCopied ? undefined : done.reason
  }

  const line = reason === undefined ? `Copied ${LABELS[format]}.` : `Could not copy ${LABELS[format]}: ${reason}`
  await say($, line)

  return line
}

// The terminal width, as the last drawing measured it.
let terminalColumns: number | undefined

function paneWidth(): number {
  if (terminalColumns === undefined) {
    return WIDTH
  }

  return Math.max(MIN_WIDTH, Math.min(WIDTH, Math.floor(terminalColumns * 0.42)))
}

// `focus` is only for the person's own /draft: a pane that took the keys
// in the middle of a turn would eat what they type next.
async function openPane($: EngineInterface, isFocused = false) {
  return $.ui.open({ id: PANE, title: 'Draft', columns: paneWidth(), closeOnEscape: true, ...(isFocused ? { focus: true as const } : {}) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'draft', description: DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({
      name: COMMAND,
      description: 'Open the draft pane, or copy the last draft: /draft rich | md | plain | subject',
      argumentHint: '[rich|md|plain|subject|close]',
    })

    // Drafts from earlier sessions come back, so /draft still finds the
    // email you wrote yesterday.
    if ((await read($, drafts)).length === 0) {
      const kept = await $.store.get(STORE_KEY)
      if (Array.isArray(kept) && kept.length > 0) {
        await update($, drafts, () => kept as Draft[])
      }
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(TOOL)) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'meatproxy:drafts', text: RULE, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true || !DRAFT_WORDS.test(e.text)) {
      return next(e)
    }

    return next({ ...e, context: [...(e.context ?? []), REMINDER] })
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const body = asText(e.body)
    if (body === undefined) {
      return { deny: 'The draft needs a non-empty `body`.' }
    }

    const draft: Draft = { id: 0, body, subject: asText(e.subject), to: asText(e.to), createdAt: await $.clock.now() }
    const list = await update($, drafts, old => [...old, { ...draft, id: (old[old.length - 1]?.id ?? 0) + 1 }].slice(-KEPT))
    await update($, shown, () => -1)
    await $.store.set(STORE_KEY, list)

    const opened = await openPane($)
    if (opened.isPlaced) {
      return { result: 'The draft is open in the Draft pane, where the user copies it. Do not repeat it in your reply.' }
    }

    const surfaces = await $.session.surfaces()
    if (surfaces.includes('terminal') || surfaces.includes('desktop')) {
      $.ui.toast('Draft ready. Run /draft to open it.', { timeoutMs: 8000 })

      return {
        result: 'The draft is saved, but the terminal is too narrow to open the pane by itself. Tell the user to run /draft to open it. Do not repeat the draft in your reply.',
      }
    }

    return { result: 'No pane is available on this surface. Show the draft to the user in your reply, exactly as written.' }
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    terminalColumns = e.presentation.columns
    const arg = e.args.trim().toLowerCase()

    if (arg === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'Closed the draft pane.' }
    }

    const formats: Record<string, Format> = { rich: 'rich', html: 'rich', md: 'md', markdown: 'md', plain: 'plain', text: 'plain', subject: 'subject' }
    const format = formats[arg]
    if (format !== undefined) {
      const found = current(await read($, drafts), await read($, shown))
      if (!found) {
        return { text: 'There is no draft yet. Ask Claude to draft a reply.' }
      }

      return { text: await copy($, found.draft, format) }
    }

    if (arg !== '') {
      return { text: `Unknown option "${arg}". Use /draft, or /draft rich | md | plain | subject | close.` }
    }

    const opened = await openPane($, true)

    return { text: opened.isPlaced ? 'Opened the draft pane. Press r, m, p or s to copy, Esc to close.' : `The draft pane could not open: ${opened.reason}` }
  })

  // The pane shows the draft, so the transcript row shows a short line
  // in place of the whole body. The model still reads the full text.
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    terminalColumns = e.viewport?.columns ?? terminalColumns
    const input = (e.props.input ?? {}) as Record<string, unknown>
    const body = asText(input.body)
    if (body === undefined) {
      return next(e)
    }
    const lines = body.split('\n').length
    const short: Record<string, string> = {}
    for (const key of ['to', 'subject'] as const) {
      const value = asText(input[key])
      if (value !== undefined) {
        short[key] = value
      }
    }
    short.body = `${lines} ${lines === 1 ? 'line' : 'lines'}, shown in the Draft pane (/draft opens it)`

    return next({ ...e, props: { ...e.props, input: short } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const list = await read($, drafts)
    const at = await read($, shown)
    const line = await read($, notice)
    const found = current(list, at)

    if (!found) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No drafts yet. Ask Claude to draft a reply, and it shows here.</Text>
          <Button key="close" hotkey="x" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      )
    }

    const { draft, index } = found
    const press = (format: Format) => (p: { surface: RenderSurface }) => {
      void copy($, draft, format, p.surface)
    }
    const go = (step: number) => () => update($, shown, () => Math.min(list.length - 1, Math.max(0, index + step)))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="rich" hotkey="r" variant="primary" label="Copy rich text" onPress={press('rich')} />
            <Button key="md" hotkey="m" label="Markdown" onPress={press('md')} />
            <Button key="plain" hotkey="p" label="Plain" onPress={press('plain')} />
            {draft.subject !== undefined && <Button key="subject" hotkey="s" label="Subject" onPress={press('subject')} />}
            <Button key="close" hotkey="x" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
          <Box flexDirection="row" columnGap={1}>
            {list.length > 1 && <Button key="prev" hotkey="k" label="‹ Older" onPress={go(-1)} />}
            {list.length > 1 && <Button key="next" hotkey="j" label="Newer ›" onPress={go(1)} />}
            <Text dimColor>
              Draft {index + 1} of {list.length}
            </Text>
            {line !== null && (
              <Text color={line.startsWith('Copied') ? 'green' : 'red'}>
                {line}
              </Text>
            )}
          </Box>
        </Box>
        {(draft.to !== undefined || draft.subject !== undefined) && (
          <Box flexDirection="column">
            {draft.to !== undefined && (
              <Text>
                <Text dimColor>To: </Text>
                {draft.to}
              </Text>
            )}
            {draft.subject !== undefined && (
              <Text>
                <Text dimColor>Subject: </Text>
                <Text bold>{draft.subject}</Text>
              </Text>
            )}
          </Box>
        )}
        <Markdown key="body" text={draft.body} />
      </Box>
    )
  })
}
