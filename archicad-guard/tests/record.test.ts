import { expect, test } from 'claude-code/testing'

import { backupNameOf, COPY_SCRIPT, dirOf, join, mdLineOf, outcomeOf, placeOf, projectKeyOf, savedOf, stemOf } from '../hooks/lib/record'

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

test('placeOf: one archicad-guard folder beside the .pln, or why there is none', () => {
  const ok = placeOf({ name: 'Hala', path: 'C:\\Jobs\\Hala\\Hala.pln', isUntitled: false, isTeamwork: false })

  expect(ok).toEqual({
    kind: 'ok',
    place: {
      projectPath: 'C:\\Jobs\\Hala\\Hala.pln',
      folder: 'C:\\Jobs\\Hala\\archicad-guard',
      backups: 'C:\\Jobs\\Hala\\archicad-guard\\backups',
      jsonl: 'C:\\Jobs\\Hala\\archicad-guard\\changes.jsonl',
      md: 'C:\\Jobs\\Hala\\archicad-guard\\CHANGELOG.md',
    },
  })
  expect(placeOf(null).kind).toBe('none')
  expect(placeOf({ name: null, path: null, isUntitled: true, isTeamwork: false }).kind).toBe('none')
  expect(placeOf({ name: 'x', path: 'D:/x.pln', isUntitled: false, isTeamwork: true }).kind).toBe('none')
  expect(placeOf({ name: 'x', path: 'x.pln', isUntitled: false, isTeamwork: false }).kind).toBe('none')
})

test('paths: dirOf, stemOf, join keep the separator the path uses; the state key ignores case and separator', () => {
  expect(dirOf('D:/a/b.pln')).toBe('D:/a')
  expect(dirOf('b.pln')).toBeNull()
  expect(stemOf('C:\\a\\Hala Beius.v2.pln')).toBe('Hala Beius.v2')
  expect(join('C:\\a\\', 'b', 'c')).toBe('C:\\a\\b\\c')
  expect(join('D:/a', 'b')).toBe('D:/a/b')
  expect(projectKeyOf('C:\\Jobs\\Hala.PLN')).toBe(projectKeyOf('c:/jobs/hala.pln'))
})

test('backupNameOf: project name and local time, -n when taken, no characters Windows refuses', () => {
  const ms = new Date(2026, 10, 25, 14, 3, 9).getTime()

  expect(backupNameOf('C:\\Jobs\\Hala.pln', ms)).toBe('Hala_2026-11-25_140309.pln')
  expect(backupNameOf('C:\\Jobs\\Hala.pln', ms, 3)).toBe('Hala_2026-11-25_140309-3.pln')
})

test('the copy script never overwrites and takes its paths from the environment only', () => {
  expect(COPY_SCRIPT).toContain('[System.IO.File]::Copy($env:AG_SRC, $env:AG_DST, $false)')
  expect(COPY_SCRIPT).not.toMatch(/[A-Z]:\\/)
})

test('savedOf: a save that worked, failed, or is still a job', () => {
  expect(savedOf(text({ success: true }))).toEqual({ kind: 'ok' })
  expect(savedOf(text({ status: 'completed', result: { success: true } }))).toEqual({ kind: 'ok' })
  expect(savedOf(text({ status: 'running', jobHandle: 'j' }))).toEqual({ kind: 'running', job: 'j' })
  expect(savedOf(text({ status: 'running' })).kind).toBe('failed')
  expect(savedOf(text({ success: false, error: { message: 'read-only' } }))).toEqual({ kind: 'failed', why: '{"message":"read-only"}' })
  expect(savedOf({ content: [{ type: 'text', text: 'nope' }], isError: true })).toEqual({ kind: 'failed', why: 'nope' })
  expect(savedOf(null).kind).toBe('failed')
})

test('outcomeOf: done, failed, partly failed, still running', () => {
  expect(outcomeOf({ text: '{"executionResults":[{"success":true}]}', result: {} })).toEqual({ status: 'done', detail: null })
  expect(outcomeOf({ text: 'ok', result: {} })).toEqual({ status: 'done', detail: null })
  expect(outcomeOf({ isError: true, text: 'boom', result: 'boom' })).toEqual({ status: 'failed', detail: 'boom' })
  expect(outcomeOf({ deny: 'no' })).toEqual({ status: 'failed', detail: 'refused before it ran: no' })
  expect(outcomeOf({ text: '{"executionResults":[{"success":false}]}', result: {} })).toEqual({ status: 'failed', detail: 'all 1 failed' })
  expect(outcomeOf(null).status).toBe('failed')
})

test('mdLineOf: more than three elements are summed up', () => {
  const ms = new Date(2026, 10, 25, 14, 3, 9).getTime()
  const line = mdLineOf({ kind: 'change', time: '', command: 'elements_delete_elements', tool: 't', port: 1, project: 'p', elements: ['a', 'b', 'c', 'd', 'e'], status: 'done', detail: null, backup: null, who: 'by Claude, approved by Sebastian' }, ms)

  expect(line).toBe('- 2026-11-25 14:03 · elements_delete_elements · 5 elements (a, b, c and 2 more) · done · by Claude, approved by Sebastian\n')
})
