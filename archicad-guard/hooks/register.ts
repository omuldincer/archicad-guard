// archicad-guard: asks before Claude changes the Archicad model (point 1.3). The deciding and wording are in lib/guard.ts;
// this file asks Archicad for the project and a dry run, asks the person, and answers the call. Everything that needs `$`
// is a `function` declaration (the validator refuses an arrow const for it).

import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import { takesDryRun } from './lib/command-kind'
import { gateOf, jsonOfResult, OPTIONS, GO, HEADER, previewText, projectInfoOf, questionOf, stoppedText, stopReason, TAPIR_CALL, TAPIR_SERVER, type Facts, type Preview, type ProjectInfo, type TapirCall } from './lib/guard'

export { TAPIR_CALL_TOOL } from './lib/guard'

/**
 * How long the look-ups in Archicad may take before the question goes out without them. A `$.clock.sleep` counts
 * against the hook's 10 s budget (other `$` calls do not), so this stays well under it, and the sleep is cancelled as
 * soon as Archicad answers, so the time the person takes to answer is never counted.
 */
const LOOKUP_TIMEOUT_MS = 4_000

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

/** Whether the call may run: null to let it run, else the text Claude reads. Never throws: a failure is a stop. */
async function decide($: EngineInterface, input: Record<string, unknown>): Promise<string | null> {
  try {
    let gate: ReturnType<typeof gateOf>

    try {
      gate = gateOf(input)
    } catch {
      // Unclear counts as a change: ask without the details.
      gate = { kind: 'ask', call: null, tool: String(input['tool'] ?? '') }
    }

    if (gate.kind === 'pass') return null

    let question: string

    try {
      const facts: Facts = { tool: gate.tool, call: gate.call, project: null, preview: { kind: 'none' } }

      if (gate.call !== null) {
        const [project, preview] = await Promise.all([projectOf($, gate.call), previewOf($, gate.call)])

        facts.project = project
        facts.preview = preview
      }

      question = questionOf(facts)
    } catch {
      question = `Claude wants to run an Archicad call the guard could not describe (${gate.tool}). Let it run?`
    }

    const answer = await ask($, question)

    return answer === GO ? null : stoppedText(stopReason(answer))
  } catch {
    return stoppedText('the guard itself failed while checking this call')
  }
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const stopped = await decide($, e as unknown as Record<string, unknown>)

    return stopped === null ? next(e) : { deny: stopped }
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
