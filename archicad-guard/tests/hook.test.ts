import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

import { TAPIR_CALL_TOOL } from '../hooks/register'
import { backupNameOf } from '../hooks/lib/record'

// A fake Archicad: nothing here reaches a real one. The Tapir tool at the bottom only records what would have run, and
// `$.mcp.call` (the guard's own look-ups) is answered by a fake server.

const PORT = 19723
const GUID_A = '11111111-1111-4111-8111-111111111111'
const GUID_B = '22222222-2222-4222-8222-222222222222'
const PLN = 'D:/scratch/scratch.pln'
const PLN_SIZE = 52_428_800
const FOLDER = 'D:/scratch/archicad-guard'
const BACKUPS = `${FOLDER}/backups`
const JSONL = `${FOLDER}/changes.jsonl`
const MD = `${FOLDER}/CHANGELOG.md`
const NOW = Date.UTC(2026, 10, 25, 12, 3, 9)
const OK_TEXT = '{"executionResults":[{"success":true}]}'
const OK_RESULT = { result: { content: [{ type: 'text', text: OK_TEXT }] }, text: OK_TEXT }

type World = {
  answer: string
  /** What `project_save_project` answers: fine, an error, a job still running (then fine), or a job that never ends. */
  save: 'ok' | 'error' | 'running' | 'stuck'
  /** The copy of the .pln: fine, an error exit, or a copy of the wrong size. */
  copy: 'ok' | 'error' | 'short'
  /** The log files refuse to be written. */
  failWrite: boolean
  /** What the Tapir tool at the bottom answers when the change runs. */
  toolResult: unknown
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
  copies: { argv: readonly string[]; env: Record<string, string> | undefined }[]
  /** The fake disk: text files by path. The .pln files are sizes only. */
  disk: Map<string, string>
  sizes: Map<string, number>
}

/** The engine hands fs paths to hooks in the host's spelling (backslashes on Windows): the fake disk keys by '/'. */
const key = (path: string): string => path.replace(/\\/g, '/')

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

function world(on: On, over: Partial<World> = {}): { w: World; seen: Seen } {
  const w: World = { answer: 'Stop', save: 'ok', copy: 'ok', failWrite: false, toolResult: OK_RESULT, failAsk: false, project: { isUntitled: false, isTeamwork: false, projectName: 'scratch', projectPath: PLN }, dryRun: { dryRun: true, executionResults: [{ success: true }] }, slow: false, ...over }
  const seen: Seen = { ran: [], asked: [], looked: [], copies: [], disk: new Map(), sizes: new Map([[PLN, PLN_SIZE]]) }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The guard's look-up timeout never fires on its own here: a slow Archicad is its own test.
  on('clock.sleep', (_, e, next) => (w.slow ? next(e) : new Promise<never>(() => {})))
  on('mcp.call', (_, e) => {
    seen.looked.push({ server: e.server, tool: e.tool, args: e.args })

    const name = e.args['name']

    if (w.slow) return new Promise<never>(() => {})

    if (name === 'project_get_project_info') return { value: text(w.project) } as never
    if (name === 'project_save_project') {
      if (w.save === 'error') return { value: { content: [{ type: 'text', text: 'The project is read-only.' }], isError: true } } as never
      if (w.save === 'running' || w.save === 'stuck') return { value: text({ status: 'running', jobHandle: 'job-1' }) } as never

      return { value: text({ success: true }) } as never
    }
    if (e.tool === 'archicad_get_job') return { value: text(w.save === 'stuck' ? { status: 'running', jobHandle: 'job-1' } : { status: 'completed', result: { success: true } }) } as never
    if (w.dryRun === 'throw') throw new Error('Archicad is not answering')
    if (w.dryRun === 'error') return { value: { content: [{ type: 'text', text: 'no such element' }], isError: true } } as never

    return { value: text(w.dryRun) } as never
  })
  on('clock.now', () => ({ value: NOW }) as never)
  on('fs.exists', (_, e) => ({ value: seen.disk.has(key(e.path)) || seen.sizes.has(key(e.path)) }) as never)
  on('fs.stat', (_, e) => {
    const size = seen.sizes.get(key(e.path)) ?? seen.disk.get(key(e.path))?.length

    return (size === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file', size, mtimeMs: 0, isLink: false } }) as never
  })
  on('fs.read', (_, e) => {
    const body = seen.disk.get(key(e.path))

    return (body === undefined ? { deny: `ENOENT: ${e.path}` } : { value: body }) as never
  })
  on('fs.write', (_, e) => {
    if (w.failWrite) return { deny: 'EACCES: permission denied' } as never

    seen.disk.set(key(e.path), e.text)

    return { value: undefined } as never
  })
  on('process.run', (_, e) => {
    const env = e.init?.env

    seen.copies.push({ argv: e.argv, env })

    const done = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }) as never

    if (w.copy === 'error') return done(1, '', 'Exception calling "Copy": The process cannot access the file.\r\n')

    const size = seen.sizes.get(key(env?.['AG_SRC'] ?? '')) ?? 0

    if (env?.['AG_DST'] !== undefined) seen.sizes.set(key(env['AG_DST']), size)

    return done(0, `${w.copy === 'short' ? size - 1 : size}\r\n`)
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions?: { question: string; options: { label: string }[]; header?: string }[] }).questions ?? []

      seen.asked.push({ question: q[0]?.question ?? '', options: (q[0]?.options ?? []).map(o => o.label), header: q[0]?.header })

      if (w.failAsk) throw new Error('nobody to ask')

      return { result: { questions: q, answers: { [q[0]?.question ?? '']: w.answer } } } as never
    }

    seen.ran.push({ tool: e.tool, name: (e as unknown as { name?: unknown }).name })

    return w.toolResult as never
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
    ['Claude wants to change the Archicad model: elements_move_elements.', `Project: scratch (${PLN}), port ${PORT}.`, 'Elements: 2.', `Before it runs: the project is saved, then copied to ${BACKUPS}.`, 'Let it run?'].join('\n'),
  )
  // Only the project look-up: a move takes no dry run, and a "Stop" saves and writes nothing.
  expect(seen.looked.map(l => l.args['name'])).toEqual(['project_get_project_info'])
  expect(seen.copies).toEqual([])
  expect([...seen.disk.keys()]).toEqual([])
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

test('the dry run not answering: the question still goes out, saying so', async ($, on) => {
  const { seen } = world(on, { dryRun: 'throw' })

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
  // Unreadable arguments name no port, so no project can be read and backed up: stopped before any question.
  expect((await tapir($, 'elements_get_all_elements', 'not json')).deny).toContain('no backup can be made')
  expect(seen.asked).toHaveLength(2)
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

test('the other Archicad tools: known reads pass, anything else on those servers is stopped (no project to back up), other tools are not touched', async ($, on) => {
  const { seen } = world(on)

  await start($)
  await $.tool.call({ tool: 'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_list_commands' } as never)
  await $.tool.call({ tool: 'mcp__archicad-public__GetArchicadInstances' } as never)
  await $.tool.call({ tool: 'mcp__other__thing' } as never)
  expect(seen.ran).toHaveLength(3)

  const out = (await $.tool.call({ tool: 'mcp__archicad-public__DeleteEverything' } as never)) as { deny?: string }

  expect(out.deny).toBe('archicad-guard stopped this: mcp__archicad-public__DeleteEverything is not a Tapir command, so the guard cannot tell which project it changes, back it up or log it. Nothing was changed in Archicad. Ask the user before trying again.')
  expect(seen.asked).toEqual([])
  expect(seen.ran).toHaveLength(3)
})

test('Archicad too slow to answer: no project means no backup, so the change is stopped without a question', async ($, on) => {
  const { seen } = world(on, { slow: true })

  await start($)

  const out = await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [{ elementId: { guid: GUID_A } }] } })

  expect(out.deny).toBe('archicad-guard stopped this: no backup can be made: the guard could not read which project is open in Archicad. Every change needs one first. Nothing was changed in Archicad. Ask the user before trying again.')
  expect(seen.asked).toEqual([])
  expect(seen.ran).toEqual([])
})

// Point 1.4: the backup before the first change of the session, and the change log.

const BACKUP_FILE = /^D:\/scratch\/archicad-guard\/backups\/scratch_2026-11-25_\d{6}\.pln$/

const lines = (seen: Seen): Record<string, unknown>[] => (seen.disk.get(JSONL) ?? '').trimEnd().split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>)

const move = ($: Engine) => tapir($, 'elements_move_elements', { port: PORT, params: { elementsWithMoveVectors: [{ elementId: { guid: GUID_A }, moveVector: { x: 1, y: 0, z: 0 } }] } })

test('the first approved change: saves in place (no path), copies the .pln into the backup folder, then runs and logs it', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  await start($)

  const out = await move($)

  expect(out.deny).toBeUndefined()
  expect(seen.ran).toEqual([{ tool: TAPIR_CALL_TOOL, name: 'elements_move_elements' }])

  // Saved in place: params empty, never a projectPath (that would be Save As).
  const save = seen.looked.find(l => l.args['name'] === 'project_save_project')

  expect(save?.args['arguments']).toEqual({ port: PORT, params: {} })

  // Copied by PowerShell, the paths passed as environment variables.
  expect(seen.copies).toHaveLength(1)
  expect(seen.copies[0]?.argv[0]).toBe('powershell.exe')
  expect(seen.copies[0]?.env?.['AG_SRC']).toBe(PLN)
  expect(seen.copies[0]?.env?.['AG_DIR']).toBe(BACKUPS)
  expect(seen.copies[0]?.env?.['AG_DST']).toMatch(BACKUP_FILE)

  const backup = seen.copies[0]?.env?.['AG_DST'] ?? ''

  // The log: the backup, then the change.
  const [made, change] = lines(seen)

  expect(made).toMatchObject({ kind: 'backup', project: PLN, backup, bytes: PLN_SIZE })
  expect(change).toEqual({
    kind: 'change',
    time: '2026-11-25T12:03:09.000Z',
    command: 'elements_move_elements',
    tool: TAPIR_CALL_TOOL,
    port: PORT,
    project: PLN,
    elements: [GUID_A],
    status: 'done',
    detail: null,
    backup,
    who: 'by Claude, approved by Sebastian',
  })

  const md = seen.disk.get(MD) ?? ''

  expect(md.startsWith('# Archicad changes\n')).toBe(true)
  expect(md).toMatch(/- 2026-11-25 \d\d:\d\d · backup made: scratch_2026-11-25_\d{6}\.pln \(50\.0 MB\) · by archicad-guard, before the first change of the session\n/)
  expect(md).toMatch(new RegExp(`- 2026-11-25 \\d\\d:\\d\\d · elements_move_elements · 1 element \\(${GUID_A}\\) · done · by Claude, approved by Sebastian\\n$`))
})

test('later changes in the same session: no second backup, the question names the one made, each change gets its line', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  await start($)
  await move($)
  await move($)

  expect(seen.copies).toHaveLength(1)
  expect(seen.looked.filter(l => l.args['name'] === 'project_save_project')).toHaveLength(1)
  expect(seen.asked[1]?.question).toMatch(/Backup: already made this session \(D:\/scratch\/archicad-guard\/backups\/scratch_2026-11-25_\d{6}\.pln\)\./)
  expect(seen.asked[1]?.question).not.toContain('Before it runs')
  expect(lines(seen).map(l => l['kind'])).toEqual(['backup', 'change', 'change'])
})

test('an existing log is added to, never replaced', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  seen.disk.set(JSONL, '{"kind":"change","command":"earlier"}\n')
  seen.disk.set(MD, '# Archicad changes\n\n- earlier line\n')
  await start($)
  await move($)

  expect(lines(seen).map(l => l['command'] ?? l['kind'])).toEqual(['earlier', 'backup', 'elements_move_elements'])
  expect(seen.disk.get(MD)?.startsWith('# Archicad changes\n\n- earlier line\n- ')).toBe(true)
})

test('a backup name already taken gets -2', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  seen.sizes.set(BACKUPS + '/' + backupNameOf(PLN, NOW), 1)
  await start($)
  await move($)
  expect(seen.copies[0]?.env?.['AG_DST']).toBe(BACKUPS + '/' + backupNameOf(PLN, NOW, 2))
})

test('untitled, Teamwork, or no file path: no backup can be made, so the change is stopped without a question', async ($, on) => {
  const { w, seen } = world(on, { answer: 'Go ahead' })

  await start($)

  w.project = { isUntitled: true, isTeamwork: false }
  expect((await move($)).deny).toContain('no backup can be made: the project is untitled (never saved)')

  w.project = { isUntitled: false, isTeamwork: true, projectName: 'office', projectPath: 'D:/tw/office.pln' }
  expect((await move($)).deny).toContain('no backup can be made: it is a Teamwork project')

  w.project = { isUntitled: false, isTeamwork: false, projectName: 'scratch' }
  expect((await move($)).deny).toContain('no backup can be made: Archicad did not say where the project file is')

  expect(seen.asked).toEqual([])
  expect(seen.ran).toEqual([])
  expect(seen.copies).toEqual([])
})

test('the save fails (read-only project): the change is stopped and nothing is logged', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead', save: 'error' })

  await start($)

  const out = await move($)

  expect(out.deny).toBe('archicad-guard stopped this: the backup failed: Archicad could not save the project (The project is read-only.). The change was not run. Nothing was changed in Archicad. Ask the user before trying again.')
  expect(seen.ran).toEqual([])
  expect(seen.copies).toEqual([])
  expect([...seen.disk.keys()]).toEqual([])
})

test('a save Tapir reports as still running is waited on with archicad_get_job', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead', save: 'running' })

  await start($)
  expect((await move($)).deny).toBeUndefined()

  const poll = seen.looked.find(l => l.tool === 'archicad_get_job')

  expect(poll?.args).toEqual({ job_handle: 'job-1' })
  expect(seen.ran).toHaveLength(1)
})

test('a save that never finishes stops the change', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead', save: 'stuck' })

  await start($)
  expect((await move($)).deny).toContain('the backup failed: Archicad was still saving the project after waiting')
  expect(seen.looked.filter(l => l.tool === 'archicad_get_job')).toHaveLength(10)
  expect(seen.ran).toEqual([])
})

test('the copy fails, or comes out the wrong size: the change is stopped, and the next try backs up again', async ($, on) => {
  const { w, seen } = world(on, { answer: 'Go ahead', copy: 'error' })

  await start($)
  expect((await move($)).deny).toContain('the backup failed: the copy failed (Exception calling "Copy": The process cannot access the file.)')

  w.copy = 'short'
  expect((await move($)).deny).toContain(`the copy is not the same size as the project (${PLN_SIZE - 1} of ${PLN_SIZE} bytes)`)

  w.copy = 'ok'
  expect((await move($)).deny).toBeUndefined()
  expect(seen.copies).toHaveLength(3)
  expect(seen.ran).toHaveLength(1)
})

test('the project file missing on disk: stopped', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  seen.sizes.clear()
  await start($)
  expect((await move($)).deny).toContain(`the project file could not be found on disk (${PLN})`)
  expect(seen.ran).toEqual([])
})

test('a change that fails in Archicad is logged as failed, a half-failed one as partly failed', async ($, on) => {
  const { w, seen } = world(on, { answer: 'Go ahead', toolResult: { isError: true, result: 'Error: element not found', text: 'Error: element not found' } })

  await start($)
  await move($)

  w.toolResult = { result: {}, text: '{"executionResults":[{"success":true},{"success":false,"error":{"code":1,"message":"locked"}}]}' }
  await move($)

  w.toolResult = { result: {}, text: '{"status":"running","jobHandle":"job-9"}' }
  await move($)

  const changes = lines(seen).filter(l => l['kind'] === 'change')

  expect(changes.map(l => [l['status'], l['detail']])).toEqual([
    ['failed', 'Error: element not found'],
    ['partly failed', '1 of 2 failed'],
    ['still running', 'Archicad is still running it (job job-9)'],
  ])
  expect(seen.disk.get(MD)).toContain(' · failed (Error: element not found) · ')
})

test('the log cannot be written: the change has run, so Claude is told it is missing from the log', async ($, on) => {
  const { w, seen } = world(on, { answer: 'Go ahead' })

  await start($)
  await move($)
  w.failWrite = true

  const out = (await move($)) as { deny?: string; context?: readonly string[] }

  expect(out.deny).toBeUndefined()
  expect(seen.ran).toHaveLength(2)
  expect(out.context?.at(-1)).toContain(`archicad-guard could not write the change log (${MD})`)
  expect(out.context?.at(-1)).toContain('The change ran; tell the user it is not in the log.')
})

test('reads, views and dry runs are not logged and make no backup', async ($, on) => {
  const { seen } = world(on, { answer: 'Go ahead' })

  await start($)
  await tapir($, 'elements_get_all_elements')
  await tapir($, 'elements_change_selection_of_elements')
  await tapir($, 'elements_delete_elements', { port: PORT, params: { elements: [], dryRun: true } })

  expect(seen.ran).toHaveLength(3)
  expect(seen.copies).toEqual([])
  expect([...seen.disk.keys()]).toEqual([])
})

test('Windows paths from Archicad: the folder sits beside the .pln, written with backslashes', async ($, on) => {
  const win = 'C:\\Users\\me\\SynologyDrive\\2026\\010. Hala\\00_ArchiCAD\\PLN_Master\\Hala.pln'
  const { seen } = world(on, { answer: 'Go ahead', project: { isUntitled: false, isTeamwork: false, projectName: 'Hala', projectPath: win } })

  seen.sizes.set(key(win), 1000)
  await start($)
  expect((await move($)).deny).toBeUndefined()
  expect(seen.copies[0]?.env?.['AG_DIR']).toBe('C:\\Users\\me\\SynologyDrive\\2026\\010. Hala\\00_ArchiCAD\\PLN_Master\\archicad-guard\\backups')
  expect(seen.copies[0]?.env?.['AG_DST']).toMatch(/\\archicad-guard\\backups\\Hala_2026-11-25_\d{6}\.pln$/)
  expect(seen.disk.has('C:/Users/me/SynologyDrive/2026/010. Hala/00_ArchiCAD/PLN_Master/archicad-guard/changes.jsonl')).toBe(true)
})
