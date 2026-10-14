import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__meatproxy__draft'
const SURFACES = ['terminal', 'desktop'] as const

type World = { copies: string[]; runs: { argv: readonly string[]; stdin?: string }[]; opens: number; isPlaced: boolean }

// The world beneath the mod: an engine that registers, opens the pane and
// copies, and records what the mod asked of it.
function world(on: On, isPlaced = true): World {
  const seen: World = { copies: [], runs: [], opens: 0, isPlaced }
  mock.store(on)
  mock.clock(on)
  mock.env(on, {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__meatproxy__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', () => {
    seen.opens += 1

    return { value: seen.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'terminal is 100 columns, under 144' } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', ($, e) => {
    seen.copies.push(e.text)

    return { value: { isCopied: true } }
  })
  on('process.run', ($, e) => {
    seen.runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : 'ok\n'

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return seen
}

const BODY = 'Hola Begoña:\n\nNo falta nada. Los pagos de **Lucía** están en las transferencias del 13 y del 14 de octubre.\n\nSaludos,\nAndrés'

async function start($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

describe('the draft tool', () => {
  test('opens the pane and tells Claude not to repeat the draft', async ($, on) => {
    const seen = world(on)
    await start($)
    const ran = await $.tool.call({ tool: TOOL, body: BODY, subject: 'RE: Facturación de octubre', to: 'Begoña' })

    expect(seen.opens).toBe(1)
    expect(String(ran.result)).toContain('Do not repeat it')
  })

  test('refuses an empty body', async ($, on) => {
    world(on)
    await start($)
    const ran = await $.tool.call({ tool: TOOL, body: '   ' })

    expect(ran.deny).toContain('non-empty')
  })

  test('points to /draft when the terminal is too narrow for the pane', async ($, on) => {
    world(on, false)
    await start($)
    const ran = await $.tool.call({ tool: TOOL, body: BODY })

    expect(String(ran.result)).toContain('/draft')
  })
})

describe('the system prompt', () => {
  test('tells Claude to use the tool instead of a file', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
    await start($)
    const composed = await $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: ['terminal'],
      tools: ['Read', TOOL],
      outputStyle: null,
      traits: [],
    })
    const rule = composed.sections.find(section => section.id === 'meatproxy:drafts')

    expect(rule?.scope).toBe('session')
    expect(rule?.text).toContain('Do not write the draft to a file')
  })

  test('adds nothing where the tool is not offered', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
    await start($)
    const composed = await $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: [],
      tools: ['Read'],
      outputStyle: null,
      traits: [],
    })

    expect(composed.sections).toHaveLength(1)
  })
})

describe('the pane', () => {
  for (const surface of SURFACES) {
    test(`shows the draft and copies it on ${surface}`, async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL, body: BODY, subject: 'RE: Facturación de octubre', to: 'Begoña' })

      const ui = await $.ui.mount({
        plugin: 'meatproxy',
        surface,
        component: 'Pane',
        requestId: 'draft',
        props: {
          title: 'Draft',
          isFocused: false,
          bodyColumns: 76,
          placement: 'dock',
          scroll: { top: 0, bodyRows: 40, contentRows: 40 },
          view: {},
        } as never,
      })

      expect((await ui.find({ key: 'body' }))?.text).toContain('Los pagos de **Lucía**')
      expect(await ui.find({ text: 'RE: Facturación de octubre' })).toBeDefined()
      expect(await ui.find({ text: 'Begoña' })).toBeDefined()

      await ui.press({ key: 'md' })
      expect(seen.copies.at(-1)).toBe(BODY)

      await ui.press({ key: 'plain' })
      expect(seen.copies.at(-1)).toContain('Los pagos de Lucía están')

      await ui.press({ key: 'subject' })
      expect(seen.copies.at(-1)).toBe('RE: Facturación de octubre')

      await ui.press({ key: 'rich' })
      const rich = seen.runs.find(run => run.argv[0] === 'osascript')
      expect(rich).toBeDefined()
      const payload = JSON.parse(rich?.stdin ?? '{}') as { html: string; plain: string }
      expect(payload.html).toContain('<strong>Lucía</strong>')
      expect(payload.plain).toContain('Saludos,\nAndrés')
      expect(await ui.find({ type: 'Text', text: 'Copied rich text.' })).toBeDefined()

      await ui.unmount()
    })
  }

  test('steps back to an older draft', async ($, on) => {
    world(on)
    await start($)
    await $.tool.call({ tool: TOOL, body: 'First version' })
    await $.tool.call({ tool: TOOL, body: 'Second version' })

    const ui = await $.ui.mount({
      plugin: 'meatproxy',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'draft',
      props: { title: 'Draft', isFocused: false, bodyColumns: 76, placement: 'dock', scroll: { top: 0, bodyRows: 40, contentRows: 40 }, view: {} } as never,
    })

    expect((await ui.find({ key: 'body' }))?.text).toBe('Second version')
    await ui.press({ key: 'prev' })
    expect((await ui.find({ key: 'body' }))?.text).toBe('First version')
    expect(await ui.find({ text: 'Draft 1 of 2' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the /draft command', () => {
  test('copies the last draft as markdown', async ($, on) => {
    const seen = world(on)
    await start($)
    await $.tool.call({ tool: TOOL, body: BODY })
    const ran = await $.command.run({
      command: 'draft',
      args: 'md',
      cwd: '/tmp',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    } as never)

    expect(ran.text).toBe('Copied markdown.')
    expect(seen.copies.at(-1)).toBe(BODY)
  })

  test('says so when there is no draft', async ($, on) => {
    world(on)
    await start($)
    const ran = await $.command.run({
      command: 'draft',
      args: 'rich',
      cwd: '/tmp',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    } as never)

    expect(ran.text).toContain('no draft yet')
  })
})

describe('the prompt reminder', () => {
  async function submit($: Engine, on: On, text: string) {
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context

      return { text: e.text, context: e.context }
    })
    world(on)
    await start($)
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

    return context ?? []
  }

  test('reminds Claude to use the pane when the prompt asks for an email in /tmp', async ($, on) => {
    const context = await submit($, on, 'write an email in spanish to Marta, put it on an md file in /tmp dir')

    expect(context.join('\n')).toContain('Do not write it to a file')
  })

  test('reminds Claude on a Spanish request', async ($, on) => {
    const context = await submit($, on, 'redacta una respuesta para Raúl sobre las transferencias')

    expect(context).toHaveLength(1)
  })

  test('adds nothing to a prompt that asks for no message', async ($, on) => {
    const context = await submit($, on, 'fix the failing test in src/app.ts')

    expect(context).toHaveLength(0)
  })
})

describe('the transcript row', () => {
  test('shows a short line in place of the whole body', async ($, on) => {
    let input: unknown
    world(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      input = e.props.input
      const { Text } = $.ui.resolve(e)

      return <Text>row</Text>
    })
    await start($)
    const ui = await $.ui.mount({
      plugin: 'meatproxy',
      surface: 'terminal',
      component: 'ToolUse',
      props: {
        tool: TOOL,
        input: { to: 'Begoña', subject: 'RE: Facturación de octubre', body: BODY },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      } as never,
    })

    expect(input).toEqual({ to: 'Begoña', subject: 'RE: Facturación de octubre', body: '6 lines, shown in the Draft pane (/draft opens it)' })
    await ui.unmount()
  })
})
