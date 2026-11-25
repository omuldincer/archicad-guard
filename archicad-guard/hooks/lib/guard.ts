// archicad-guard: the deciding and the wording for the gate (point 1.3). No `$` here: register.ts asks Archicad and the
// person; this file turns a call into what to ask and what to tell Claude.

import { isKnownCommand, kindOf, takesDryRun, type CommandKind } from './command-kind'

/** The one tool all Archicad traffic goes through; its `name` argument is the Tapir command. */
export const TAPIR_CALL_TOOL = 'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_call_tool'

/** The Tapir server as /mcp lists it, for `$.mcp.call`. */
export const TAPIR_SERVER = 'plugin:archicad-tapir:ArchicadTapir'

/** The tool's name on that server. */
export const TAPIR_CALL = 'archicad_call_tool'

/** Every tool of the two Archicad servers starts with one of these. */
const ARCHICAD_PREFIXES = ['mcp__plugin_archicad-tapir_ArchicadTapir__', 'mcp__archicad-public__']

/** The Archicad tools that only read (Decisions, 2026-11-25). Any other tool on those servers asks. */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_get_job',
  'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_list_commands',
  'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_get_command_schema',
  'mcp__plugin_archicad-tapir_ArchicadTapir__discovery_list_active_archicads',
  'mcp__archicad-public__GetArchicadInstances',
])

export const STOP = 'Stop'
export const GO = 'Go ahead'
export const OPTIONS: readonly string[] = [STOP, GO]
export const HEADER = 'Archicad'

/** Longest preview text shown in the question. */
const PREVIEW_MAX = 600

export type TapirCall = {
  /** The Tapir command, or null when the call names none. */
  name: string | null
  port: number | null
  /** `arguments.params`, or null when absent or not an object. */
  params: Record<string, unknown> | null
  /** Whether `arguments` could be read at all. */
  isReadable: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `arguments` as an object: the model may also send it as a JSON string. */
const argumentsOf = (raw: unknown): Record<string, unknown> | null => {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(raw)

    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Reads the Tapir call out of a `tool.call` event's input (`{ tool, name, arguments: { port, params } }`). */
export function callOf(e: Record<string, unknown>): TapirCall {
  const args = argumentsOf(e['arguments'])
  const name = typeof e['name'] === 'string' ? e['name'] : null
  const port = args !== null && typeof args['port'] === 'number' && Number.isInteger(args['port']) ? args['port'] : null
  const params = args !== null && isRecord(args['params']) ? args['params'] : null

  return { name, port, params, isReadable: args !== null }
}

export type Gate =
  | { kind: 'pass'; why: 'read' | 'view' | 'dry run' | 'not archicad' }
  | { kind: 'ask'; call: TapirCall | null; tool: string }

/** Whether `params.dryRun` is true on a command that takes it: Tapir then changes nothing and makes no undo step. */
export const isDryRun = (call: TapirCall): boolean => call.name !== null && takesDryRun(call.name) && call.params?.['dryRun'] === true

/**
 * What to do with a tool call. Not an Archicad tool, a read or a view → pass. A dry run → pass. Anything else on the
 * Archicad servers (a change, an unknown command, an unreadable call, a tool of theirs not known to read) → ask.
 */
export function gateOf(e: Record<string, unknown>): Gate {
  const tool = typeof e['tool'] === 'string' ? e['tool'] : ''

  if (tool !== TAPIR_CALL_TOOL) {
    if (!ARCHICAD_PREFIXES.some(prefix => tool.startsWith(prefix)) || READ_TOOLS.has(tool)) return { kind: 'pass', why: 'not archicad' }

    return { kind: 'ask', call: null, tool }
  }

  const call = callOf(e)
  const kind: CommandKind = call.isReadable ? kindOf(call.name) : 'change'

  if (kind === 'read' || kind === 'view') return { kind: 'pass', why: kind }
  if (call.isReadable && isDryRun(call)) return { kind: 'pass', why: 'dry run' }

  return { kind: 'ask', call, tool }
}

/** The distinct element guids the call names (any `elementId: { guid }` or `elementGuid`/`guid` string, at any depth). */
export function elementGuidsOf(params: unknown): string[] {
  const found = new Set<string>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)

      return
    }
    if (!isRecord(value)) return

    const id = value['elementId']

    if (isRecord(id) && typeof id['guid'] === 'string') found.add(id['guid'].toLowerCase())

    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'elementId') walk(inner, depth + 1)
    }
  }

  walk(params, 0)

  return [...found]
}

export type ProjectInfo = { name: string | null; path: string | null; isUntitled: boolean; isTeamwork: boolean }

/** The first text block of an MCP result, read as JSON; null when there is none or it is not JSON. */
export function jsonOfResult(result: { content?: readonly { type: string; text?: string }[] } | null): unknown {
  const text = result?.content?.find(block => block.type === 'text' && typeof block.text === 'string')?.text

  if (text === undefined) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** `project_get_project_info`'s answer, tolerant of a wrapper (`{ result: {...} }`) and missing fields. */
export function projectInfoOf(json: unknown): ProjectInfo | null {
  const body = isRecord(json) && isRecord(json['result']) ? json['result'] : json

  if (!isRecord(body)) return null

  const str = (key: string): string | null => (typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : null)

  return { name: str('projectName'), path: str('projectPath') ?? str('projectLocation'), isUntitled: body['isUntitled'] === true, isTeamwork: body['isTeamwork'] === true }
}

/** How the project reads in the question. */
export function projectText(info: ProjectInfo | null): string {
  if (info === null) return 'could not be read'
  if (info.isUntitled) return 'untitled (never saved)'

  const name = info.name ?? 'no name given'
  const extra = [info.isTeamwork ? 'Teamwork' : null, info.path].filter(x => x !== null)

  return extra.length > 0 ? `${name} (${extra.join(', ')})` : name
}

export type Preview = { kind: 'none' } | { kind: 'shown'; text: string } | { kind: 'failed'; why: string }

/** A dry-run answer cut to fit the question. */
export function previewText(result: { content?: readonly { type: string; text?: string }[]; isError?: boolean } | null): Preview {
  if (result === null) return { kind: 'failed', why: 'no answer from Archicad' }

  const json = jsonOfResult(result)
  const raw = json !== null ? JSON.stringify(json) : (result.content ?? []).map(block => block.text ?? '').join(' ').trim()

  if (result.isError === true) return { kind: 'failed', why: raw === '' ? 'Archicad reported an error' : cut(raw) }
  if (isRecord(json) && json['status'] === 'running') return { kind: 'failed', why: 'the preview is still running in Archicad' }

  return raw === '' ? { kind: 'failed', why: 'an empty answer' } : { kind: 'shown', text: cut(raw) }
}

const cut = (text: string): string => (text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)} …` : text)

export type Facts = {
  tool: string
  call: TapirCall | null
  project: ProjectInfo | null
  preview: Preview
  /** What the question says about the backup (1.4): one is made first, one was made this session, or nothing. */
  backup?: { kind: 'first'; folder: string } | { kind: 'made'; file: string } | null
}

/** The question: what Claude is about to do, in plain lines, ending in a question mark. */
export function questionOf(facts: Facts): string {
  const { call } = facts

  if (call === null) return `Claude wants to use the Archicad tool ${facts.tool}, which the guard does not know as a read. Let it run?`

  const lines: string[] = []
  const command = call.name ?? '(no command named)'

  if (!call.isReadable) lines.push(`Claude wants to run an Archicad command the guard could not read (${command}).`)
  else if (call.name === null || !isKnownCommand(call.name)) lines.push(`Claude wants to run ${command}, a command the guard does not know, so it counts as a change.`)
  else lines.push(`Claude wants to change the Archicad model: ${command}.`)

  lines.push(`Project: ${projectText(facts.project)}${call.port !== null ? `, port ${call.port}` : ''}.`)

  const count = elementGuidsOf(call.params).length

  lines.push(count === 0 ? 'Elements: none named in the call.' : `Elements: ${count}.`)

  if (facts.preview.kind === 'shown') lines.push(`Dry run says: ${facts.preview.text}`)
  if (facts.preview.kind === 'failed') lines.push(`Dry run could not be shown: ${facts.preview.why}.`)
  if (facts.backup?.kind === 'first') lines.push(`Before it runs: the project is saved, then copied to ${facts.backup.folder}.`)
  if (facts.backup?.kind === 'made') lines.push(`Backup: already made this session (${facts.backup.file}).`)

  lines.push('Let it run?')

  return lines.join('\n')
}

/** The text Claude reads when the call is stopped. */
export const stoppedText = (what: string): string => `archicad-guard stopped this: ${what}. Nothing was changed in Archicad. Ask the user before trying again.`

/** Why the call was stopped, from the person's answer (or its absence). */
export function stopReason(answer: string | null): string {
  if (answer === null) return 'there was no one to ask, or the question was closed'
  if (answer === STOP) return 'the user chose to stop it'

  return `the answer was not one of the choices (${JSON.stringify(answer)}), so it stays stopped`
}
