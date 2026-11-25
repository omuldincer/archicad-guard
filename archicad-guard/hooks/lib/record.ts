// archicad-guard: the backup and the change log, the parts without `$` (point 1.4). register.ts saves, copies, reads
// and writes; this file says where things go, what they are called, and what each line of the log says.
//
// Everything for a project lives in one folder beside its .pln (Sebastian, 2026-11-25):
//   <folder of the .pln>/archicad-guard/backups/<project>_<YYYY-MM-DD_HHMMSS>.pln   never deleted by the mod
//   <folder of the .pln>/archicad-guard/changes.jsonl                                one JSON line per entry
//   <folder of the .pln>/archicad-guard/CHANGELOG.md                                 the same, in plain words

import type { ProjectInfo, TapirCall } from './guard'

export const GUARD_FOLDER = 'archicad-guard'
export const BACKUPS_FOLDER = 'backups'
export const LOG_JSONL = 'changes.jsonl'
export const LOG_MD = 'CHANGELOG.md'

/** Who the log names for every change the guard let through. */
export const WHO = 'by Claude, approved by Sebastian'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The separator the path already uses (Archicad hands Windows paths with `\`). */
const sepOf = (path: string): string => (path.includes('\\') ? '\\' : '/')

export const join = (base: string, ...parts: string[]): string => {
  const sep = sepOf(base)

  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

/** The folder that holds the file, or null for a bare name. */
export function dirOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  return cut <= 0 ? null : path.slice(0, cut)
}

/** The file's name without folder or extension. */
export function stemOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(cut + 1)
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(0, dot) : name
}

/** The key a project is known by in the session's state: its path, one separator, lower case. */
export const projectKeyOf = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

export type Place = { projectPath: string; folder: string; backups: string; jsonl: string; md: string }

/**
 * Where a project's backups and log go, or why there is no such place. No place means no backup and no log, so the
 * change is stopped (Decisions, 1.2): untitled, Teamwork, or a project whose file the guard could not read.
 */
export function placeOf(project: ProjectInfo | null): { kind: 'ok'; place: Place } | { kind: 'none'; why: string } {
  if (project === null) return { kind: 'none', why: 'the guard could not read which project is open in Archicad' }
  if (project.isUntitled) return { kind: 'none', why: 'the project is untitled (never saved), so there is no file to back up' }
  if (project.isTeamwork) return { kind: 'none', why: 'it is a Teamwork project, which the guard cannot back up by copying a file' }
  if (project.path === null) return { kind: 'none', why: 'Archicad did not say where the project file is' }

  const dir = dirOf(project.path)

  if (dir === null) return { kind: 'none', why: `the project path is not a full path (${project.path})` }

  const folder = join(dir, GUARD_FOLDER)

  return { kind: 'ok', place: { projectPath: project.path, folder, backups: join(folder, BACKUPS_FOLDER), jsonl: join(folder, LOG_JSONL), md: join(folder, LOG_MD) } }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Local time as `2026-11-25 14:03:09`. */
export function localTime(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** A backup's file name: `<project>_2026-11-25_140309.pln`, with `-2`, `-3` … when that name is taken. */
export function backupNameOf(projectPath: string, ms: number, attempt = 1): string {
  const stamp = localTime(ms).replace(' ', '_').replace(/:/g, '')
  const stem = stemOf(projectPath).replace(/[<>:"/\\|?*]/g, '_') || 'project'

  return `${stem}_${stamp}${attempt > 1 ? `-${attempt}` : ''}.pln`
}

/**
 * The PowerShell that copies the .pln into the backup folder and prints the copy's size. Paths come in as environment
 * variables (AG_SRC, AG_DIR, AG_DST), so no quoting of a path can go wrong. `File.Copy` with `false` never overwrites.
 */
export const COPY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[void][System.IO.Directory]::CreateDirectory($env:AG_DIR)',
  '[System.IO.File]::Copy($env:AG_SRC, $env:AG_DST, $false)',
  '[System.IO.FileInfo]::new($env:AG_DST).Length',
].join('; ')

export const copyArgv = (): string[] => ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', COPY_SCRIPT]

/** The JSON of an MCP-style result's text (first text block), or of a plain text. */
function jsonOfText(text: string | undefined): unknown {
  if (text === undefined) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type McpLike = { content?: readonly { type: string; text?: string }[]; isError?: boolean } | null

const textOfMcp = (result: McpLike): string | undefined => result?.content?.find(block => block.type === 'text' && typeof block.text === 'string')?.text

/** A job Tapir is still running, as its answer names it; null when the answer is no such job. */
export function runningJobOf(json: unknown): string | null {
  const body = isRecord(json) && isRecord(json['result']) && json['status'] === undefined ? json['result'] : json

  if (!isRecord(body) || body['status'] !== 'running') return null

  const handle = body['jobHandle'] ?? body['job_handle'] ?? body['handle'] ?? body['jobId']

  return typeof handle === 'string' && handle !== '' ? handle : ''
}

export type Saved = { kind: 'ok' } | { kind: 'running'; job: string } | { kind: 'failed'; why: string }

/** What `project_save_project` (or a poll of its job) answered. */
export function savedOf(result: McpLike): Saved {
  if (result === null) return { kind: 'failed', why: 'no answer from Archicad' }

  const text = textOfMcp(result)
  const json = jsonOfText(text)

  if (result.isError === true) return { kind: 'failed', why: short(text ?? 'Archicad reported an error') }

  const job = runningJobOf(json)

  if (job !== null) return job === '' ? { kind: 'failed', why: 'the save is still running and Archicad gave no job to wait on' } : { kind: 'running', job }

  const failure = failureOf(json)

  return failure === null ? { kind: 'ok' } : { kind: 'failed', why: failure }
}

/** Why a Tapir answer says it failed, or null when it does not. */
function failureOf(json: unknown): string | null {
  if (!isRecord(json)) return null
  if (json['status'] === 'failed') return short(JSON.stringify(json['error'] ?? json))
  if (json['success'] === false) return short(JSON.stringify(json['error'] ?? json))
  if (isRecord(json['error'])) return short(JSON.stringify(json['error']))
  if (isRecord(json['result'])) return failureOf(json['result'])

  return null
}

export type Outcome = { status: 'done' | 'partly failed' | 'failed' | 'still running'; detail: string | null }

type ToolResultLike = { deny?: string; isError?: true; text?: string; result?: unknown } | null

const textOfResult = (result: NonNullable<ToolResultLike>): string | undefined =>
  result.text ?? (isRecord(result.result) ? textOfMcp(result.result as McpLike) : typeof result.result === 'string' ? result.result : undefined)

/**
 * Archicad's answer to a change that ran, as JSON, or null (denied, an error, not JSON). The log takes the guids of new
 * elements from it (found live in 1.6b: `elements_create_walls` names its wall only in the answer).
 */
export function answerJsonOf(result: ToolResultLike): unknown {
  if (result === null || typeof result.deny === 'string' || result.isError === true) return null

  return jsonOfText(textOfResult(result)) ?? null
}

/** How the change went, from what the tool call resolved to. */
export function outcomeOf(result: ToolResultLike): Outcome {
  if (result === null) return { status: 'failed', detail: 'the call never answered' }
  if (typeof result.deny === 'string') return { status: 'failed', detail: short(`refused before it ran: ${result.deny}`) }

  const text = textOfResult(result)

  if (result.isError === true) return { status: 'failed', detail: text === undefined ? null : short(text) }

  const json = jsonOfText(text)
  const job = runningJobOf(json)

  if (job !== null) return { status: 'still running', detail: job === '' ? 'Archicad is still running it' : `Archicad is still running it (job ${job})` }

  const failure = failureOf(json)

  if (failure !== null) return { status: 'failed', detail: failure }

  const results = isRecord(json) && Array.isArray(json['executionResults']) ? json['executionResults'] : null

  if (results !== null) {
    const bad = results.filter(r => isRecord(r) && r['success'] === false).length

    if (bad === results.length && bad > 0) return { status: 'failed', detail: `all ${bad} failed` }
    if (bad > 0) return { status: 'partly failed', detail: `${bad} of ${results.length} failed` }
  }

  return { status: 'done', detail: null }
}

const LINE_MAX = 300

const short = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > LINE_MAX ? `${flat.slice(0, LINE_MAX)} …` : flat
}

export type ChangeEntry = {
  kind: 'change'
  time: string
  command: string
  tool: string
  port: number | null
  project: string
  elements: string[]
  status: Outcome['status']
  detail: string | null
  backup: string | null
  who: string
}

export type BackupEntry = { kind: 'backup'; time: string; project: string; backup: string; bytes: number; who: string }

export type Entry = ChangeEntry | BackupEntry

export function changeEntryOf(input: { ms: number; tool: string; call: TapirCall; projectPath: string; elements: string[]; outcome: Outcome; backup: string | null }): ChangeEntry {
  return {
    kind: 'change',
    time: new Date(input.ms).toISOString(),
    command: input.call.name ?? '(no command named)',
    tool: input.tool,
    port: input.call.port,
    project: input.projectPath,
    elements: input.elements,
    status: input.outcome.status,
    detail: input.outcome.detail,
    backup: input.backup,
    who: WHO,
  }
}

export const backupEntryOf = (ms: number, projectPath: string, backup: string, bytes: number): BackupEntry => ({ kind: 'backup', time: new Date(ms).toISOString(), project: projectPath, backup, bytes, who: 'by archicad-guard, before the first change of the session' })

export const jsonlLineOf = (entry: Entry): string => `${JSON.stringify(entry)}\n`

export const MD_HEADER = '# Archicad changes\n\nWritten by archicad-guard, newest last. The full record (every element guid) is in changes.jsonl.\n\n'

const elementsText = (guids: readonly string[]): string => {
  if (guids.length === 0) return 'no elements named'

  const shown = guids.slice(0, 3).join(', ')
  const more = guids.length > 3 ? ` and ${guids.length - 3} more` : ''

  return `${guids.length} element${guids.length === 1 ? '' : 's'} (${shown}${more})`
}

const sizeText = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** One line of CHANGELOG.md, in plain words. `ms` is the same moment as the entry's time, shown in local time. */
export function mdLineOf(entry: Entry, ms: number): string {
  const when = localTime(ms).slice(0, 16)

  if (entry.kind === 'backup') return `- ${when} · backup made: ${stemOf(entry.backup)}.pln (${sizeText(entry.bytes)}) · ${entry.who}\n`

  const detail = entry.detail === null ? '' : ` (${entry.detail})`

  return `- ${when} · ${entry.command} · ${elementsText(entry.elements)} · ${entry.status}${detail} · ${entry.who}\n`
}
