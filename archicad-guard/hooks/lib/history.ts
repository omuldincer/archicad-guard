// archicad-guard: the two slash commands, the parts without `$` (point 1.5). register.ts finds the projects and reads
// the disk; this file reads the log and the backup names and says what the person sees.
//
//   /archicad-log [count | path to .pln]       the recent changes, in plain words
//   /archicad-restore [number | path to .pln]  the backups, newest first, and exact steps to open one
//
// Neither changes anything: the restore is steps for the person, never done by the mod (PLAN 1.5).

import { dirOf, join, localTime, mdLineOf, placeOf, stemOf, type BackupEntry, type ChangeEntry, type Entry, type Place } from './record'

export const LOG_COMMAND = 'archicad-log'
export const RESTORE_COMMAND = 'archicad-restore'

/** How many log lines `/archicad-log` shows when no count is given, and the most it shows. */
export const LOG_DEFAULT = 20
export const LOG_MAX = 200

/** How much of the end of changes.jsonl is read (`$.fs.read` refuses more than 4 MiB at once). */
export const TAIL_BYTES = 1024 * 1024

/** How many backups `/archicad-restore` lists. */
export const BACKUPS_SHOWN = 15

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What follows the command name: a whole number, a path, or nothing. Quotes around a path are dropped. */
export type Args = { kind: 'none' } | { kind: 'number'; n: number } | { kind: 'path'; path: string } | { kind: 'bad'; text: string }

export function argsOf(raw: string): Args {
  const text = raw.trim().replace(/^["']|["']$/g, '').trim()

  if (text === '') return { kind: 'none' }
  if (/^\d+$/.test(text)) {
    const n = Number(text)

    return n >= 1 ? { kind: 'number', n } : { kind: 'bad', text }
  }
  if (/\.pln$/i.test(text) && dirOf(text) !== null) return { kind: 'path', path: text }

  return { kind: 'bad', text }
}

/**
 * The ports of the running Archicads from `discovery_list_active_archicads`.
 * Live answer (1.6): `{ activeInstances: [{ port }], unavailableInstances: [{ reason, message }] }`; `active` is read too.
 * Without an active list, every `port` anywhere except under an `unavailable…` key.
 */
export function portsOf(json: unknown): number[] {
  const found = new Set<number>()
  const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)

      return
    }
    if (!isRecord(value)) return
    if (isPort(value['port'])) found.add(value['port'])

    for (const [key, inner] of Object.entries(value)) {
      if (!key.startsWith('unavailable') && key !== 'port') walk(inner, depth + 1)
    }
  }
  const body = isRecord(json) && isRecord(json['result']) ? json['result'] : json

  const listed = isRecord(body) ? [body['activeInstances'], body['active']].find(Array.isArray) : undefined

  walk(listed ?? body, 0)

  return [...found]
}

/** A project the commands work on: where its folder is, and how it reads. */
export type Found = { label: string; place: Place; source: 'archicad' | 'path' | 'session' }

/** The place for a .pln the person named, or for a project known from this session's backups. */
export function foundOfPath(path: string, source: Found['source']): Found | null {
  const where = placeOf({ name: stemOf(path), path, isUntitled: false, isTeamwork: false })

  return where.kind === 'ok' ? { label: `${stemOf(path)} (${path})`, place: where.place, source } : null
}

/**
 * A project known only from this session's backups: the state key is its path in lower case, so the spelling comes
 * back from the backup's own path (`<folder>/archicad-guard/backups/<stem>_<time>.pln`) where it can.
 */
export function projectPathOfSession(key: string, backup: string): string {
  const backups = dirOf(backup)
  const guard = backups === null ? null : dirOf(backups)
  const folder = guard === null ? null : dirOf(guard)
  const keyDir = dirOf(key)
  const name = key.slice((keyDir?.length ?? -1) + 1)
  const stem = stemOf(name)
  const file = backup.slice((backups?.length ?? -1) + 1)

  if (folder === null || keyDir === null || folder.replace(/\\/g, '/').toLowerCase() !== keyDir) return key

  const spelled = file.toLowerCase().startsWith(stem) ? file.slice(0, stem.length) : stem

  return join(folder, `${spelled}${name.slice(stem.length)}`)
}

const isChange =(v: Record<string, unknown>): boolean =>
  v['kind'] === 'change' && typeof v['command'] === 'string' && Array.isArray(v['elements']) && typeof v['status'] === 'string' && typeof v['who'] === 'string'

const isBackup = (v: Record<string, unknown>): boolean => v['kind'] === 'backup' && typeof v['backup'] === 'string' && typeof v['bytes'] === 'number' && typeof v['who'] === 'string'

/**
 * The entries of changes.jsonl, oldest first. A line that is not an entry (hand-edited, cut by a tail read, an older
 * shape) is counted, not shown. `isTail`: the text starts mid-file, so its first line is dropped as likely cut.
 */
export function entriesOf(text: string, isTail = false): { entries: Entry[]; bad: number } {
  const lines = text.split(/\r?\n/)

  if (isTail) lines.shift()

  const entries: Entry[] = []
  let bad = 0

  for (const line of lines) {
    if (line.trim() === '') continue

    try {
      const v: unknown = JSON.parse(line)

      if (isRecord(v) && typeof v['time'] === 'string' && !Number.isNaN(Date.parse(v['time'])) && (isChange(v) || isBackup(v))) {
        entries.push((v['kind'] === 'change' ? (v as ChangeEntry) : (v as BackupEntry)) as Entry)
      } else bad++
    } catch {
      bad++
    }
  }

  return { entries, bad }
}

/** What `/archicad-log` shows for one project. */
export function logText(found: Found, read: { entries: Entry[]; bad: number; isTail: boolean } | { missing: true }, count: number): string {
  const head = `Archicad changes for ${found.label}`

  if ('missing' in read) return `${head}: none logged yet (no ${found.place.jsonl}).`

  const { entries, bad, isTail } = read
  const shown = entries.slice(-count)
  const changes = entries.filter(e => e.kind === 'change')
  const failed = changes.filter(e => e.kind === 'change' && e.status !== 'done').length
  const of = isTail ? `the last ${shown.length} (the log is long; only its end was read)` : shown.length < entries.length ? `the last ${shown.length} of ${entries.length}` : `all ${entries.length}`
  const lines = [`${head}, ${of}, oldest first:`]

  if (shown.length === 0) lines.push('- nothing logged yet.')
  for (const entry of shown) lines.push(mdLineOf(entry, Date.parse(entry.time)).trimEnd())

  const notes: string[] = []

  if (failed > 0) notes.push(`${failed} change${failed === 1 ? '' : 's'} in ${isTail ? 'what was read' : 'the log'} did not fully go through (not "done").`)
  if (bad > 0) notes.push(`${bad} line${bad === 1 ? '' : 's'} of the log could not be read and ${bad === 1 ? 'is' : 'are'} left out.`)
  notes.push(`Readable log: ${found.place.md}. Every element guid: ${found.place.jsonl}.`)

  return [...lines, '', ...notes].join('\n')
}

/** One backup file in the backup folder. */
export type BackupFile = { name: string; path: string; bytes: number; ms: number | null }

/** When a backup was made, from its name (`<project>_2026-11-25_140309.pln`, maybe `-2`), in local time. */
export function timeOfName(name: string): number | null {
  const m = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:-\d+)?\.pln$/i.exec(name)

  if (m === null) return null

  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  const ms = new Date(y, mo - 1, d, h, mi, s).getTime()

  return Number.isNaN(ms) ? null : ms
}

/** The backups newest first: by the time in the name, then by name. Files the guard did not name go last. */
export function sortBackups(files: readonly BackupFile[]): BackupFile[] {
  return [...files].sort((a, b) => (b.ms ?? -1) - (a.ms ?? -1) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
}

const sizeText = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** The same path, compared without case or separator (Windows). */
const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** What `/archicad-restore` shows for one project: the list and the steps for the chosen backup (1 = newest). */
export function restoreText(found: Found, backups: readonly BackupFile[] | { missing: true }, pick: number, madeThisSession: string | null): string {
  const head = `Backups of ${found.label}`

  if ('missing' in backups || backups.length === 0) return `${head}: none yet (no backup in ${found.place.backups}). The guard makes one before the first change Claude makes in a session.`

  const list = backups.slice(0, BACKUPS_SHOWN)
  const lines = [`${head}, newest first:`]

  list.forEach((b, i) => {
    const when = b.ms === null ? 'time not in the name' : localTime(b.ms).slice(0, 16)
    const mine = madeThisSession !== null && samePath(madeThisSession, b.path) ? ' · made this session' : ''

    lines.push(`${i + 1}. ${b.name} · ${when} · ${sizeText(b.bytes)}${mine}`)
  })

  if (backups.length > list.length) lines.push(`… and ${backups.length - list.length} older, in ${found.place.backups}.`)
  if (pick > backups.length) return [...lines, '', `There is no backup ${pick}: pick 1 to ${backups.length}.`].join('\n')

  const chosen = backups[pick - 1] as BackupFile
  const project = found.place.projectPath
  const name = `${stemOf(project)}.pln`
  const folder = dirOf(project) ?? project

  lines.push(
    '',
    `The guard never restores by itself. To go back to backup ${pick} (${chosen.name}):`,
    `1. Keep today's state too, if you may want it: in Archicad File > Save, then in File Explorer copy ${name} to ${stemOf(project)}_before-restore.pln in the same folder.`,
    `2. In Archicad: File > Open > Open…, and pick ${chosen.path}. If Archicad asks to save the open project, answer as you want for today's state.`,
    `3. Right away, File > Save As…: folder ${folder}, name ${name}, and confirm Replace. You now work in the project's own file, at the backup's state; the backup stays as it was.`,
    `4. Don't let Claude change anything while the backup file itself is open (before step 3): its changes would land in the backup.`,
    '',
    `Another backup: /${RESTORE_COMMAND} <number>. Backups are never deleted by the guard.`,
  )

  return lines.join('\n')
}

/** Said when no project could be found at all. */
export function nothingFoundText(command: string, notes: readonly string[]): string {
  return [
    `archicad-guard found no project to show.${notes.length > 0 ? '' : ' Archicad is not answering (or no Archicad with Tapir is running), and no backup was made this session.'}`,
    ...notes.map(note => `- ${note}`),
    `Name the project yourself: /${command} D:\\path\\to\\project.pln`,
  ].join('\n')
}
