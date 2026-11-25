import { expect, test } from 'claude-code/testing'

import { argsOf, entriesOf, foundOfPath, logText, portsOf, restoreText, sortBackups, timeOfName, type BackupFile } from '../hooks/lib/history'
import { backupNameOf, jsonlLineOf, type ChangeEntry } from '../hooks/lib/record'

const change = (time: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({ kind: 'change', time, command: 'elements_move_elements', tool: 't', port: 1, project: 'D:/p/p.pln', elements: ['a'], status: 'done', detail: null, backup: null, who: 'by Claude, approved by Sebastian', ...over })

// argsOf
test('reads nothing, a count, a .pln path (quotes dropped), and refuses the rest', () => {
  expect(argsOf('  ')).toEqual({ kind: 'none' })
  expect(argsOf('5')).toEqual({ kind: 'number', n: 5 })
  expect(argsOf('0').kind).toBe('bad')
  expect(argsOf('"D:\\Jobs\\A house\\house.pln"')).toEqual({ kind: 'path', path: 'D:\\Jobs\\A house\\house.pln' })
  expect(argsOf('house.pln').kind).toBe('bad')
  expect(argsOf('show me everything').kind).toBe('bad')
})

// portsOf
test('takes the active ports only', () => {
  expect(portsOf({ active: [{ port: 19723, version: '28' }, { port: 19724 }], unavailable: [{ port: 19725 }] })).toEqual([19723, 19724])
  expect(portsOf({ result: { active: [{ port: 19723 }] } })).toEqual([19723])
  expect(portsOf({ unavailable: [{ port: 19725 }] })).toEqual([])
  // the live shape (1.6)
  expect(portsOf({ activeInstances: [{ port: 19723 }], unavailableInstances: [{ reason: 'unresponsive', port: 19724 }] })).toEqual([19723])
  expect(portsOf({ activeInstances: [], unavailableInstances: [{ reason: 'missing_tapir', message: 'x' }] })).toEqual([])
  expect(portsOf({ unavailableInstances: [{ port: 19724 }] })).toEqual([])
  expect(portsOf(null)).toEqual([])
})

// entriesOf
test('keeps the entries, counts the lines it cannot read, drops the cut first line of a tail', () => {
  const good = jsonlLineOf(change('2026-11-25T12:00:00.000Z'))
  const text = `${good}not json\n{"kind":"change"}\n\n${good}`

  expect(entriesOf(text)).toMatchObject({ bad: 2 })
  expect(entriesOf(text).entries).toHaveLength(2)
  expect(entriesOf(`{"kind":"chan\n${good}`, true)).toMatchObject({ bad: 0 })
})

// backup names
test('reads the time back out of a name the guard made, and sorts newest first', () => {
  const at = new Date(2026, 10, 25, 14, 3, 9).getTime()

  expect(timeOfName(backupNameOf('D:/p/house.pln', at))).toBe(at)
  expect(timeOfName(backupNameOf('D:/p/house.pln', at, 2))).toBe(at)
  expect(timeOfName('copy of house.pln')).toBeNull()

  const file = (name: string): BackupFile => ({ name, path: `D:/b/${name}`, bytes: 1, ms: timeOfName(name) })
  const sorted = sortBackups([file('house_2026-11-24_090000.pln'), file('mine.pln'), file('house_2026-11-25_140309.pln')])

  expect(sorted.map(f => f.name)).toEqual(['house_2026-11-25_140309.pln', 'house_2026-11-24_090000.pln', 'mine.pln'])
})

// texts
const found = foundOfPath('D:\\Jobs\\house.pln', 'path')!

test('the log says when nothing is logged and where the files are', () => {
  expect(logText(found, { missing: true }, 20)).toContain('none logged yet')

  const text = logText(found, { entries: [change('2026-11-25T12:00:00.000Z', { status: 'failed', detail: 'no such element' })], bad: 1, isTail: false }, 20)

  expect(text).toContain('elements_move_elements · 1 element (a) · failed (no such element)')
  expect(text).toContain('1 change in the log did not fully go through')
  expect(text).toContain('1 line of the log could not be read')
  expect(text).toContain('D:\\Jobs\\archicad-guard\\CHANGELOG.md')
})

test('restore steps name the backup, the project folder and file, and never claim to restore', () => {
  const b: BackupFile = { name: 'house_2026-11-25_140309.pln', path: 'D:\\Jobs\\archicad-guard\\backups\\house_2026-11-25_140309.pln', bytes: 3 * 1024 * 1024, ms: timeOfName('house_2026-11-25_140309.pln') }
  const text = restoreText(found, [b], 1, 'd:/jobs/archicad-guard/backups/house_2026-11-25_140309.pln')

  expect(text).toContain('1. house_2026-11-25_140309.pln · 2026-11-25 14:03 · 3.0 MB · made this session')
  expect(text).toContain('The guard never restores by itself')
  expect(text).toContain(`pick ${b.path}`)
  expect(text).toContain('folder D:\\Jobs, name house.pln, and confirm Replace')
  expect(restoreText(found, [b], 3, null)).toContain('There is no backup 3')
  expect(restoreText(found, { missing: true }, 1, null)).toContain('none yet')
})
