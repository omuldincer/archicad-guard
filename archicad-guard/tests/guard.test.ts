import { expect, test } from 'claude-code/testing'

import { elementGuidsOf, gateOf, previewText, projectInfoOf, projectText, TAPIR_CALL_TOOL } from '../hooks/lib/guard'

const call = (name: unknown, args: unknown) => gateOf({ tool: TAPIR_CALL_TOOL, tool_use_id: 't', name, arguments: args })

test('the gate: read, view and dry run pass; change, unknown and unreadable ask', () => {
  expect(call('elements_get_all_elements', { port: 1 }).kind).toBe('pass')
  expect(call('elements_change_selection_of_elements', { port: 1 }).kind).toBe('pass')
  expect(call('elements_delete_elements', { port: 1, params: { dryRun: true } })).toEqual({ kind: 'pass', why: 'dry run' })
  expect(call('elements_delete_elements', { port: 1, params: { dryRun: 'true' } }).kind).toBe('ask')
  expect(call('elements_move_elements', { port: 1, params: { dryRun: true } }).kind).toBe('ask')
  expect(call('elements_delete_elements', { port: 1, params: {} }).kind).toBe('ask')
  expect(call('nope', { port: 1 }).kind).toBe('ask')
  expect(call('elements_get_all_elements', 'garbage').kind).toBe('ask')
  expect(call('elements_get_all_elements', null).kind).toBe('ask')
  expect(gateOf({ tool: 'Bash', command: 'ls' }).kind).toBe('pass')
})

test('element guids are counted once, at any depth, case-insensitive', () => {
  const a = 'AAAAAAAA-0000-4000-8000-000000000000'

  expect(elementGuidsOf({ elements: [{ elementId: { guid: a } }, { elementId: { guid: a.toLowerCase() } }] })).toHaveLength(1)
  expect(elementGuidsOf({ x: { y: [{ z: { elementId: { guid: 'b' } } }] }, elementId: { guid: 'c' } })).toHaveLength(2)
  expect(elementGuidsOf(null)).toEqual([])
  expect(elementGuidsOf({ elementId: 'not an object' })).toEqual([])
})

test('project info: plain, wrapped, untitled, Teamwork, unreadable', () => {
  expect(projectText(projectInfoOf({ projectName: 'A', projectPath: 'D:/a.pln' }))).toBe('A (D:/a.pln)')
  expect(projectText(projectInfoOf({ result: { projectName: 'A', isTeamwork: true } }))).toBe('A (Teamwork)')
  expect(projectText(projectInfoOf({ isUntitled: true }))).toBe('untitled (never saved)')
  expect(projectText(projectInfoOf('x'))).toBe('could not be read')
  expect(projectText(null)).toBe('could not be read')
})

test('a long preview is cut; a running job is not shown as a preview', () => {
  const long = previewText({ content: [{ type: 'text', text: JSON.stringify({ s: 'x'.repeat(2000) }) }] })

  expect(long.kind).toBe('shown')
  expect(long.kind === 'shown' && long.text.length).toBeLessThan(700)
  expect(previewText({ content: [{ type: 'text', text: JSON.stringify({ status: 'running', jobHandle: 'j' }) }] }).kind).toBe('failed')
  expect(previewText({ content: [] })).toEqual({ kind: 'failed', why: 'an empty answer' })
  expect(previewText(null)).toEqual({ kind: 'failed', why: 'no answer from Archicad' })
})
