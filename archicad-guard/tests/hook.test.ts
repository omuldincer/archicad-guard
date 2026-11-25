import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

import { TAPIR_CALL_TOOL } from '../hooks/register'

// A fake Archicad: nothing here reaches a real one. The Tapir tool at the bottom only records what would have run, and
// `$.mcp.call` (the guard's own look-ups) is answered by a fake server.

const PORT = 19723
const GUID_A = '11111111-1111-4111-8111-111111111111'
const GUID_B = '22222222-2222-4222-8222-222222222222'

type World = {
  answer: string
  failAsk: boolean
  project: unknown
  /** The dry-run answer, or 'error' / 'throw'. */
  dryRun: unknown
  /** Archicad never answers the guard's look-ups, and the guard's timeout runs out. */
  slow: boolean
}

type Seen = {
  ran: { tool: string; name?: unknown }[]
  asked: { question: string; options: readonly string[]; header: string | undefined }[]
  looked: { server: string; tool: string; args: Record<string, unknown> }[]
}

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

function world(on: On, over: Partial<World> = {}): { w: World; seen: Seen } {
  const w: World = { answer: 'Stop', failAsk: false, project: { isUntitled: false, isTeamwork: false, projectName: 'scratch', projectPath: 'D:/scratch/scratch.pln' }, dryRun: { dryRun: true, executionResults: [{ success: true }] }, slow: false, ...over }
  const seen: Seen = { ran: [], asked: [], looked: [] }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The guard's look-up timeout never fires on its own here: a slow Archicad is its own test.
  on('clock.sleep', (_, e, next) => (w.slow ? next(e) : new Promise<never>(() => {})))
  on('mcp.call', (_, e) => {
    seen.looked.push({ server: e.server, tool: e.tool, args: e.args })

    const name = e.args['name']

    if (w.slow) return new Promise<never>(() => {})

    if (name === 'project_get_project_info') return { value: text(w.project) } as never
    if (w.dryRun === 'throw') throw new Error('Archicad is not answering')
    if (w.dryRun === 'error') return { value: { content: [{ type: 'text', text: 'no such element' }], isError: true } } as never

    return { value: text(w.dryRun) } as never
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions?: { question: string; options: { label: string }[]; header?: string }[] }).questions ?? []

      seen.asked.push({ question: q[0]?.question ?? '', options: (q[0]?.options ?? []).map(o => o.label), header: q[0]?.header })

      if (w.failAsk) throw new Error('nobody to ask')

      return { result: { questions: q, answers: { [q[0]?.question ?? '']: w.answer } } } as never
    }

    seen.ran.push({ tool: e.tool, name: (e as unknown as { name?: unknown }).name })

    return { result: { content: [{ type: 'text', text: 'ok' }] }, text: 'ok' } as never
  })

  return { w, seen }
}

const start = ($: Engine) => $.session.start({ cwd: 'D:/scratch', surface: 'desktop', isInteractive: true })

const tapir = ($: Engine, name: unknown, args: unknown = { port: PORT, params: {} }) =>
  $.tool.call({ tool: TAPIR_CALL_TOOL, name, arguments: args } as never) as Promise<{ deny?: string; text?: string }>

test('a read passes without a question', async ($, on) => {
  const { seen } = world(on)

  await start($)

  const out = await tapir($, 'elements_get_all_elements')

  expect(out.deny).toBeUndefined()
  expect(seen.asked).toEqual([])
  expect(seen.looked).toEqual([])
  expect(seen.ran).toEqual([{ tool: TAPIR_CALL_TOOL, name: 'elements_get_all_elements' }])
})

test('a view command passes without a question', async ($, on) => {
  const { seen } = world(on)

  await start($)
  expect((await tapir($, 'elements_change_selection_of_elements')).deny).toBeUndefined()
  expect(seen.asked).toEqual([])
})

test('a change asks with the command, project and element count; "Stop" blocks it and tells Claude why', async ($, on) => {
  const { seen } = world(on)

  await start($)

  const params = { elementsWithMoveVectors: [{ elementId: { guid: GUID_A }, moveVector: { x: 1, y: 0, z: 0 } }, { elementId: { guid: GUID_B }, moveVector: { x: 1, y: 0, z: 0 } }] }
  const out = await tapir($, 'elements_move_elements', { port: PORT, params })

  expect(out.deny).toBe('archicad-guard stopped this: the user chose to stop it. Nothing was changed in Archicad. Ask the user before trying again.')
  expect(seen.ran).toEqual([])
  expect(seen.asked).toHaveLength(1)
  expect(seen.asked[0]?.options).toEqual(['Stop', 'Go ahead'])
  expect(seen.asked[0]?.header).toBe('Archicad')
  expect(seen.asked[0]?.question).toBe(
    ['Claude wants to change the Archicad model: elements_move_elements.', `Project: scratch (D:/scratch/scratch.pln), port ${PORT}.`, 'Elements: 2.', 'Let it run?'].join('\n'),
  )
  // Only the project look-up: a move takes no dry run.
  expect(seen.looked.map(l => l.args['name'])).toEqual(['project_get_project_info'])
})

test('"Go ahead" runs the change', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  await start($)

  const out = await tapir($, 'elements_move_elements', { port: PORT, params: { elementsWithMoveVectors: [] } })

  expect(out.deny).toBeUndefined()
  expect(seen.ran).toEqual([{ tool: TAPIR_CALL_TOOL, name: 'elements_move_elements' }])
})

test('every change asks again: a yes is for that call only', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  await start($)
  await tapir($, 'elements_move_elements')
  await tapir($, 'elements_move_elements')
  expect(seen.asked).toHaveLength(2)
  expect(seen.ran).toHaveLength(2)
})

test('a delete shows its dry run in the question, and the dry run goes to Tapir with dryRun true', async ($, on) => {
  const { seen } = world(on)

  await start($)

  const params = { elements: [{ elementId: { guid: GUID_A } }] }

  await tapir($, 'elements_delete_elements', { port: PORT, params })

  const dry = seen.looked.find(l => l.args['name'] === 'elements_delete_elements')

  expect(dry?.server).toBe('plugin:archicad-tapir:ArchicadTapir')
  expect(dry?.tool).toBe('archicad_call_tool')
  expect(dry?.args['arguments']).toEqual({ port: PORT, params: { ...params, dryRun: true } })
  expect(seen.asked[0]?.question).toContain('Elements: 1.')
  expect(seen.asked[0]?.question).toContain('Dry run says: {"dryRun":true,"executionResults":[{"success":true}]}')
  expect(seen.ran).toEqual([])
})

test('a failed dry run still asks, and says the preview failed', async ($, on) => {
  const { seen } = world(on, { dryRun: 'error' })

  await start($)
  await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [{ elementId: { guid: GUID_A } }] } })
  expect(seen.asked[0]?.question).toContain('Dry run could not be shown: no such element.')
})

test('Archicad not answering: the question still goes out, without the project', async ($, on) => {
  const { seen } = world(on, { dryRun: 'throw', project: 'not json' })

  await start($)
  await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [] } })
  expect(seen.asked).toHaveLength(1)
  expect(seen.asked[0]?.question).toContain('Dry run could not be shown: no answer from Archicad.')
  expect(seen.ran).toEqual([])
})

test('a dry run Claude asks for itself passes: Tapir changes nothing then', async ($, on) => {
  const { seen } = world(on)

  await start($)

  const out = await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [], dryRun: true } })

  expect(out.deny).toBeUndefined()
  expect(seen.asked).toEqual([])
})

test('unknown, missing or unreadable commands ask (fail closed)', async ($, on) => {
  const { seen } = world(on)

  await start($)
  expect((await tapir($, 'elements_teleport_elements')).deny).toContain('stopped this')
  expect(seen.asked[0]?.question).toContain('elements_teleport_elements, a command the guard does not know, so it counts as a change.')
  expect((await tapir($, undefined)).deny).toContain('stopped this')
  expect((await tapir($, 'elements_get_all_elements', 'not json')).deny).toContain('stopped this')
  expect(seen.asked[2]?.question).toContain('could not read')
  expect(seen.asked).toHaveLength(3)
  expect(seen.ran).toEqual([])
})

test('arguments sent as a JSON string are read', async ($, on) => {
  const { seen } = world(on)

  await start($)
  expect((await tapir($, 'elements_get_all_elements', JSON.stringify({ port: PORT }))).deny).toBeUndefined()
  expect(seen.asked).toEqual([])
})

test('no one to ask, or an answer that is not a choice, blocks', async ($, on) => {
  const { w } = world(on, { failAsk: true })

  await start($)
  expect((await tapir($, 'elements_move_elements')).deny).toContain('there was no one to ask, or the question was closed')
  w.failAsk = false
  w.answer = 'maybe later'
  expect((await tapir($, 'elements_move_elements')).deny).toContain('the answer was not one of the choices ("maybe later")')
})

test('the other Archicad tools: known reads pass, anything else on those servers asks, other tools are not touched', async ($, on) => {
  const { seen } = world(on)

  await start($)
  await $.tool.call({ tool: 'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_list_commands' } as never)
  await $.tool.call({ tool: 'mcp__archicad-public__GetArchicadInstances' } as never)
  await $.tool.call({ tool: 'mcp__other__thing' } as never)
  expect(seen.asked).toEqual([])

  const out = (await $.tool.call({ tool: 'mcp__archicad-public__DeleteEverything' } as never)) as { deny?: string }

  expect(out.deny).toContain('stopped this')
  expect(seen.asked[0]?.question).toBe('Claude wants to use the Archicad tool mcp__archicad-public__DeleteEverything, which the guard does not know as a read. Let it run?')
})

test('Archicad too slow to answer: the question goes out after the timeout, without project or preview', async ($, on) => {
  const { seen } = world(on, { slow: true })

  await start($)
  await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [{ elementId: { guid: GUID_A } }] } })
  expect(seen.asked).toHaveLength(1)
  expect(seen.asked[0]?.question).toContain('Project: could not be read, port 19723.')
  expect(seen.asked[0]?.question).toContain('Dry run could not be shown: no answer from Archicad.')
  expect(seen.ran).toEqual([])
})
