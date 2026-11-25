// archicad-guard: asks before Claude changes the Archicad model (1.3), backs the project up before the first change of
// the session and logs every change it let through (1.4). The deciding and wording are in lib/guard.ts, the places and
// log lines in lib/record.ts; this file asks Archicad, the person and the disk. Everything that needs `$` is a
// `function` declaration (the validator refuses an arrow const for it).

import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { Backups } from '../types'
import { takesDryRun } from './lib/command-kind'
import { elementGuidsOf, gateOf, jsonOfResult, OPTIONS, GO, HEADER, previewText, projectInfoOf, questionOf, stoppedText, stopReason, TAPIR_CALL, TAPIR_SERVER, type Facts, type Preview, type ProjectInfo, type TapirCall } from './lib/guard'
import { backupEntryOf, backupNameOf, changeEntryOf, copyArgv, jsonlLineOf, join, MD_HEADER, mdLineOf, outcomeOf, placeOf, projectKeyOf, savedOf, type Entry, type Place } from './lib/record'

export { TAPIR_CALL_TOOL } from './lib/guard'

/**
 * How long the look-ups in Archicad may take before the question goes out without them. A `$.clock.sleep` counts
 * against the hook's 10 s budget (other `$` calls do not), so this stays well under it, and the sleep is cancelled as
 * soon as Archicad answers, so the time the person takes to answer is never counted.
 */
const LOOKUP_TIMEOUT_MS = 4_000

/** How many times the guard asks Tapir about a save still running; each `archicad_get_job` waits on its own. */
const SAVE_POLLS = 10

/** How long the copy of the .pln may take (a large project on a slow disk). */
const COPY_TIMEOUT_MS = 10 * 60_000

const BACKUPS = { plugin: 'archicad-guard', key: 'backups' } as const

/** One Tapir command through the engine's own connection, or null when it fails or takes too long. */
async function tapir($: EngineInterface, name: string, args: Record<string, unknown>): Promise<McpToolResult | null> {
  const stop = new AbortController()

  try {
    const call = $.mcp.call(TAPIR_SERVER, TAPIR_CALL, { name, arguments: args }).catch(() => null)
    const late = $.clock.sleep(LOOKUP_TIMEOUT_MS, { signal: stop.signal }).then(
      () => null,
      () => null,
    )

    return await Promise.race([call, late])
  } catch {
    return null
  } finally {
    stop.abort()
  }
}

async function projectOf($: EngineInterface, call: TapirCall): Promise<ProjectInfo | null> {
  if (call.port === null) return null

  const result = await tapir($, 'project_get_project_info', { port: call.port })

  return result === null || result.isError ? null : projectInfoOf(jsonOfResult(result))
}

/** The dry run of a command that takes one: the same call with `params.dryRun: true`. Tapir changes nothing then. */
async function previewOf($: EngineInterface, call: TapirCall): Promise<Preview> {
  if (call.name === null || !takesDryRun(call.name)) return { kind: 'none' }
  if (call.port === null || call.params === null) return { kind: 'failed', why: 'the call has no port or params to preview' }

  return previewText(await tapir($, call.name, { port: call.port, params: { ...call.params, dryRun: true } }))
}

/** Asks the person; null when dismissed or no one can be asked. */
async function ask($: EngineInterface, question: string): Promise<string | null> {
  try {
    return await $.ui.ask(question, { options: OPTIONS, header: HEADER })
  } catch {
    return null
  }
}

async function backupsOf($: EngineInterface): Promise<Backups> {
  try {
    const { value } = await $.state.get(BACKUPS)

    return value ?? {}
  } catch {
    return {}
  }
}

/**
 * Saves the project in place (never with a path: that would be Save As), then copies its .pln into the backup folder.
 * The full backup path, or why there is none. No timer on the save: `$.mcp.call` does not count against the budget and
 * a save may take long; a job Tapir reports as still running is asked about again with `archicad_get_job`.
 */
async function makeBackup($: EngineInterface, call: TapirCall, place: Place): Promise<{ kind: 'ok'; file: string; bytes: number } | { kind: 'failed'; why: string }> {
  if (call.port === null) return { kind: 'failed', why: 'the call names no Archicad port' }

  let saved = savedOf(await $.mcp.call(TAPIR_SERVER, TAPIR_CALL, { name: 'project_save_project', arguments: { port: call.port, params: {} } }).catch(() => null))

  for (let poll = 0; saved.kind === 'running' && poll < SAVE_POLLS; poll++) {
    saved = savedOf(await $.mcp.call(TAPIR_SERVER, 'archicad_get_job', { job_handle: saved.job }).catch(() => null))
  }

  if (saved.kind === 'running') return { kind: 'failed', why: 'Archicad was still saving the project after waiting' }
  if (saved.kind === 'failed') return { kind: 'failed', why: `Archicad could not save the project (${saved.why})` }

  let source: number

  try {
    source = (await $.fs.stat(place.projectPath)).size
  } catch {
    return { kind: 'failed', why: `the project file could not be found on disk (${place.projectPath})` }
  }

  const now = await $.clock.now()
  let file = join(place.backups, backupNameOf(place.projectPath, now))

  for (let attempt = 2; (await $.fs.exists(file)) && attempt < 100; attempt++) file = join(place.backups, backupNameOf(place.projectPath, now, attempt))

  let copied: Awaited<ReturnType<EngineInterface['process']['run']>>

  try {
    copied = await $.process.run(copyArgv(), { env: { AG_SRC: place.projectPath, AG_DIR: place.backups, AG_DST: file }, timeoutMs: COPY_TIMEOUT_MS })
  } catch (error) {
    return { kind: 'failed', why: `the copy did not finish (${error instanceof Error ? error.message : String(error)})` }
  }

  if (copied.exitCode !== 0) return { kind: 'failed', why: `the copy failed (${copied.stderr.trim().split('\n')[0] ?? `exit ${copied.exitCode}`})` }

  const bytes = Number(copied.stdout.trim())

  if (!Number.isFinite(bytes) || bytes !== source) return { kind: 'failed', why: `the copy is not the same size as the project (${copied.stdout.trim() || 'no size'} of ${source} bytes)` }

  return { kind: 'ok', file, bytes }
}

/** Adds one entry to both logs. Throws when the disk refuses. */
async function writeLog($: EngineInterface, place: Place, entry: Entry, ms: number): Promise<void> {
  const jsonl = (await $.fs.exists(place.jsonl)) ? await $.fs.read(place.jsonl) : ''
  const md = (await $.fs.exists(place.md)) ? await $.fs.read(place.md) : MD_HEADER

  await $.fs.write(place.jsonl, jsonl + jsonlLineOf(entry))
  await $.fs.write(place.md, md + mdLineOf(entry, ms))
}

/** A change the guard let through, with what the log needs. */
type Approved = { tool: string; call: TapirCall; place: Place; backup: string }

type Decision = { kind: 'stop'; text: string } | { kind: 'run'; approved: Approved | null }

/** Whether the call may run, and what to log when it does. Never throws: a failure is a stop. */
async function decide($: EngineInterface, input: Record<string, unknown>): Promise<Decision> {
  try {
    let gate: ReturnType<typeof gateOf>

    try {
      gate = gateOf(input)
    } catch {
      // Unclear counts as a change: ask without the details.
      gate = { kind: 'ask', call: null, tool: String(input['tool'] ?? '') }
    }

    if (gate.kind === 'pass') return { kind: 'run', approved: null }

    // A change needs a backup and a log, so a call that names no project (another Archicad tool) cannot be let through.
    if (gate.call === null) return { kind: 'stop', text: stoppedText(`${gate.tool} is not a Tapir command, so the guard cannot tell which project it changes, back it up or log it`) }

    const call = gate.call
    const [project, preview] = await Promise.all([projectOf($, call), previewOf($, call)])
    const where = placeOf(project)

    if (where.kind === 'none') return { kind: 'stop', text: stoppedText(`no backup can be made: ${where.why}. Every change needs one first`) }

    const place = where.place
    const backups = await backupsOf($)
    const made = backups[projectKeyOf(place.projectPath)]
    const facts: Facts = { tool: gate.tool, call, project, preview, backup: made === undefined ? { kind: 'first', folder: place.backups } : { kind: 'made', file: made } }

    let question: string

    try {
      question = questionOf(facts)
    } catch {
      question = `Claude wants to run an Archicad call the guard could not describe (${gate.tool}). Let it run?`
    }

    const answer = await ask($, question)

    if (answer !== GO) return { kind: 'stop', text: stoppedText(stopReason(answer)) }
    if (made !== undefined) return { kind: 'run', approved: { tool: gate.tool, call, place, backup: made } }

    const backup = await makeBackup($, call, place)

    if (backup.kind === 'failed') return { kind: 'stop', text: stoppedText(`the backup failed: ${backup.why}. The change was not run`) }

    await $.state.set(BACKUPS, { ...(await backupsOf($)), [projectKeyOf(place.projectPath)]: backup.file })

    const now = await $.clock.now()

    try {
      await writeLog($, place, backupEntryOf(now, place.projectPath, backup.file, backup.bytes), now)
    } catch {
      // The backup itself is on disk; a log line missing for it is not a reason to stop the change.
    }

    return { kind: 'run', approved: { tool: gate.tool, call, place, backup: backup.file } }
  } catch {
    return { kind: 'stop', text: stoppedText('the guard itself failed while checking this call') }
  }
}

/** Logs the change as it went. Never throws: a log that cannot be written is said to Claude and the person instead. */
async function logChange($: EngineInterface, approved: Approved, result: Parameters<typeof outcomeOf>[0]): Promise<string | null> {
  try {
    const now = await $.clock.now()
    const entry = changeEntryOf({ ms: now, tool: approved.tool, call: approved.call, projectPath: approved.place.projectPath, elements: elementGuidsOf(approved.call.params), outcome: outcomeOf(result), backup: approved.backup })

    await writeLog($, approved.place, entry, now)

    return null
  } catch (error) {
    const why = `archicad-guard could not write the change log (${approved.place.md}): ${error instanceof Error ? error.message : String(error)}. The change ran; tell the user it is not in the log.`

    try {
      $.ui.toast(why)
    } catch {
      // No surface to show it on: Claude still reads it.
    }

    return why
  }
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const decision = await decide($, e as unknown as Record<string, unknown>)

    if (decision.kind === 'stop') return { deny: decision.text }
    if (decision.approved === null) return next(e)

    const result = await next(e)
    const unlogged = await logChange($, decision.approved, result as Parameters<typeof outcomeOf>[0])

    if (unlogged === null || 'deny' in result) return result

    return { ...result, context: [...(result.context ?? []), unlogged] }
  }).catch(($, e, next) => {
    // The hook threw or ran out of time. Past `next` the call already ran; before it, an Archicad call is refused.
    if (next.called) return next(e)

    return passesUnasked(e as unknown as Record<string, unknown>) ? next(e) : { deny: stoppedText('the guard itself failed while checking this call') }
  })
}

/** Whether the call would pass without a question; anything unclear does not. */
const passesUnasked = (input: Record<string, unknown>): boolean => {
  try {
    return gateOf(input).kind === 'pass'
  } catch {
    return typeof input['tool'] === 'string' && !input['tool'].toLowerCase().includes('archicad')
  }
}
