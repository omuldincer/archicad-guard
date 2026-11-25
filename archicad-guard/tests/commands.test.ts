import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

import { jsonlLineOf, type BackupEntry, type ChangeEntry } from '../hooks/lib/record'

// /archicad-log and /archicad-restore through the engine, with a fake Archicad and a fake disk. Nothing here reaches a
// real one, and the commands only read: every write or process is recorded and must stay empty.

const PORT = 19723
const PLN = 'D:/scratch/scratch.pln'
const FOLDER = 'D:/scratch/archicad-guard'
const BACKUPS = `${FOLDER}/backups`
const JSONL = `${FOLDER}/changes.jsonl`
const NEWER = 'scratch_2026-11-25_140309.pln'
const OLDER = 'scratch_2026-11-24_090000.pln'

type World = {
  /** What `discovery_list_active_archicads` answers, 'error', or 'slow' (never answers). */
  archicads: unknown
  project: unknown
  /** The session's backups in `$.state`. */
  made: Record<string, string>
}

type Seen = { looked: { tool: string; args: Record<string, unknown> }[]; writes: string[]; runs: number; registered: string[]; reads: { path: string; offset?: number }[]; disk: Map<string, string>; sizes: Map<string, number> }

const key = (path: string): string => path.replace(/\\/g, '/')
const parentOf = (path: string): string => key(path).slice(0, key(path).lastIndexOf('/'))
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

const change = (time: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({ kind: 'change', time, command: 'elements_move_elements', tool: 'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_call_tool', port: PORT, project: PLN, elements: ['11111111-1111-4111-8111-111111111111'], status: 'done', detail: null, backup: `${BACKUPS}/${NEWER}`, who: 'by Claude, approved by Sebastian', ...over })
const backup: BackupEntry = { kind: 'backup', time: '2026-11-25T12:03:09.000Z', project: PLN, backup: `${BACKUPS}/${NEWER}`, bytes: 52_428_800, who: 'by archicad-guard, before the first change of the session' }

function world(on: On, over: Partial<World> = {}): { w: World; seen: Seen } {
  const w: World = { archicads: { active: [{ port: PORT }], unavailable: [] }, project: { isUntitled: false, isTeamwork: false, projectName: 'scratch', projectPath: PLN }, made: {}, ...over }
  const seen: Seen = { looked: [], writes: [], runs: 0, registered: [], reads: [], disk: new Map(), sizes: new Map() }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    seen.registered.push(e.name)

    return { value: { command: e.name } } as never
  })
  on('clock.sleep', (_, e, next) => (w.archicads === 'slow' ? next(e) : new Promise<never>(() => {})))
  on('mcp.call', (_, e) => {
    seen.looked.push({ tool: e.tool, args: e.args })

    if (w.archicads === 'slow') return new Promise<never>(() => {})
    if (e.tool === 'discovery_list_active_archicads') return { value: w.archicads === 'error' ? { content: [{ type: 'text', text: 'no Archicad' }], isError: true } : text(w.archicads) } as never
    if (e.args['name'] === 'project_get_project_info') return { value: text(w.project) } as never

    throw new Error(`the commands should not call ${e.tool} ${String(e.args['name'])}`)
  })
  on('state.get', () => ({ value: { value: w.made, version: 1 } }) as never)
  on('fs.exists', (_, e) => ({ value: seen.disk.has(key(e.path)) || seen.sizes.has(key(e.path)) || [...seen.sizes.keys(), ...seen.disk.keys()].some(p => parentOf(p) === key(e.path)) }) as never)
  on('fs.stat', (_, e) => {
    const size = seen.sizes.get(key(e.path)) ?? seen.disk.get(key(e.path))?.length

    return (size === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file', size, mtimeMs: 0, isLink: false } }) as never
  })
  on('fs.read', (_, e) => {
    seen.reads.push({ path: key(e.path), offset: e.offset })

    const body = seen.disk.get(key(e.path))

    if (body === undefined) return { deny: `ENOENT: ${e.path}` } as never

    return { value: e.offset === undefined ? body : body.slice(e.offset, e.offset + (e.length ?? body.length)) } as never
  })
  on('fs.list', (_, e) => ({ value: [...seen.sizes.entries()].filter(([p]) => parentOf(p) === key(e.path)).map(([p, size]) => ({ name: p.slice(p.lastIndexOf('/') + 1), kind: 'file', size, mtimeMs: 0, isLink: false })) }) as never)
  on('fs.write', (_, e) => {
    seen.writes.push(e.path)

    return { value: undefined } as never
  })
  on('process.run', () => {
    seen.runs++

    return { deny: 'no processes here' } as never
  })

  return { w, seen }
}

const start = ($: Engine) => $.session.start({ cwd: 'D:/scratch', surface: 'desktop', isInteractive: true })
const run = async ($: Engine, command: string, args = '') => (await $.command.run({ command, args } as never)).text ?? ''

const nothingChanged = (seen: Seen) => {
  expect(seen.writes).toEqual([])
  expect(seen.runs).toBe(0)
  expect(seen.looked.every(l => l.tool === 'discovery_list_active_archicads' || l.args['name'] === 'project_get_project_info')).toBe(true)
}

test('both commands are registered when the session starts', async ($, on) => {
  const { seen } = world(on)

  await start($)

  expect(seen.registered).toEqual(['archicad-log', 'archicad-restore'])
})

test('/archicad-log: the open project, its entries in plain words, where the full log is; nothing written', async ($, on) => {
  const { seen } = world(on)

  seen.disk.set(JSONL, jsonlLineOf(backup) + jsonlLineOf(change('2026-11-25T12:03:10.000Z')) + jsonlLineOf(change('2026-11-25T12:05:00.000Z', { command: 'elements_delete_elements', status: 'failed', detail: 'no such element' })))
  await start($)

  const out = await run($, 'archicad-log')

  expect(out).toContain(`Archicad changes for scratch (${PLN}), all 3, oldest first:`)
  expect(out).toContain('backup made: scratch_2026-11-25_140309.pln (50.0 MB)')
  expect(out).toContain('elements_move_elements · 1 element (11111111-1111-4111-8111-111111111111) · done · by Claude, approved by Sebastian')
  expect(out).toContain('elements_delete_elements · 1 element (11111111-1111-4111-8111-111111111111) · failed (no such element)')
  expect(out).toContain(`Readable log: ${FOLDER}/CHANGELOG.md`)
  expect(seen.looked[0]).toEqual({ tool: 'discovery_list_active_archicads', args: {} })
  expect(seen.looked[1]?.args).toEqual({ name: 'project_get_project_info', arguments: { port: PORT } })
  nothingChanged(seen)
})

test('/archicad-log 1 shows the last one; a long log is read from its end only', async ($, on) => {
  const { seen } = world(on)
  const lines = Array.from({ length: 6000 }, (_, i) => jsonlLineOf(change(new Date(Date.UTC(2026, 10, 25, 12, 0, 0) + i * 1000).toISOString(), { command: `elements_move_elements_${i}` })))

  seen.disk.set(JSONL, lines.join(''))
  await start($)

  const one = await run($, 'archicad-log', '1')

  expect(one).toContain('the last 1 (the log is long; only its end was read)')
  expect(one).toContain('elements_move_elements_5999')
  expect(one).not.toContain('elements_move_elements_5998 ')
  expect(seen.reads.at(-1)?.offset).toBeGreaterThan(0)
  nothingChanged(seen)
})

test('/archicad-log with a path works without Archicad, and says when nothing is logged', async ($, on) => {
  const { seen } = world(on, { archicads: 'error' })

  await start($)

  const out = await run($, 'archicad-log', '"D:\\Jobs\\house.pln"')

  expect(out).toBe('Archicad changes for house (D:\\Jobs\\house.pln): none logged yet (no D:\\Jobs\\archicad-guard\\changes.jsonl).')
  expect(seen.looked).toEqual([])
})

test('Archicad not answering and no backup this session: says so and how to name the project', async ($, on) => {
  world(on, { archicads: 'slow' })

  await start($)

  const out = await run($, 'archicad-log')

  expect(out).toContain('archicad-guard found no project to show. Archicad is not answering')
  expect(out).toContain('/archicad-log D:\\path\\to\\project.pln')
})

test('an untitled project in Archicad is noted; the projects this session backed up are still shown', async ($, on) => {
  const { seen } = world(on, { project: { isUntitled: true }, made: { 'd:/scratch/scratch.pln': `${BACKUPS}/${NEWER}` } })

  seen.disk.set(JSONL, jsonlLineOf(backup))
  await start($)

  const out = await run($, 'archicad-log')

  expect(out).toContain(`Archicad changes for scratch (${PLN}), all 1`)
  expect(out).toContain(`(Archicad on port ${PORT}: the project is untitled`)
})

test('anything else after the command gets the usage', async ($, on) => {
  world(on)
  await start($)

  expect(await run($, 'archicad-log', 'everything please')).toBe('Usage: /archicad-log [count | D:\\path\\to\\project.pln]')
  expect(await run($, 'archicad-restore', 'house.pln')).toBe('Usage: /archicad-restore [number | D:\\path\\to\\project.pln]')
})

test('/archicad-restore: the backups newest first, this session marked, steps for the newest; nothing changed', async ($, on) => {
  const { seen } = world(on, { made: { 'd:/scratch/scratch.pln': `D:\\scratch\\archicad-guard\\backups\\${NEWER}` } })

  seen.sizes.set(`${BACKUPS}/${OLDER}`, 40 * 1024 * 1024)
  seen.sizes.set(`${BACKUPS}/${NEWER}`, 52_428_800)
  seen.sizes.set(`${BACKUPS}/notes.txt`, 10)
  await start($)

  const out = await run($, 'archicad-restore')

  expect(out).toContain(`Backups of scratch (${PLN}), newest first:\n1. ${NEWER} · 2026-11-25 14:03 · 50.0 MB · made this session\n2. ${OLDER} · 2026-11-24 09:00 · 40.0 MB`)
  expect(out).not.toContain('notes.txt')
  expect(out).toContain(`To go back to backup 1 (${NEWER})`)
  expect(out).toContain(`pick ${BACKUPS}/${NEWER}`)
  expect(out).toContain('folder D:/scratch, name scratch.pln, and confirm Replace')
  nothingChanged(seen)
})

test('/archicad-restore 2 gives the steps for the older one; a number past the list says so; no folder says none yet', async ($, on) => {
  const { seen } = world(on)

  seen.sizes.set(`${BACKUPS}/${OLDER}`, 1024)
  seen.sizes.set(`${BACKUPS}/${NEWER}`, 1024)
  await start($)

  expect(await run($, 'archicad-restore', '2')).toContain(`To go back to backup 2 (${OLDER})`)
  expect(await run($, 'archicad-restore', '7')).toContain('There is no backup 7: pick 1 to 2.')
  expect(await run($, 'archicad-restore', 'D:\\Other\\other.pln')).toContain('Backups of other (D:\\Other\\other.pln): none yet')
  nothingChanged(seen)
})
