// archicad-guard: guards changes to the Archicad model made through the archicad-tapir MCP plugin.
// Skeleton (point 1.1): no hooks yet. The gate on the Tapir call tool comes in 1.3, backup and change log in 1.4.

import type { Register } from 'claude-code'

/** The one tool all Archicad traffic goes through; its `name` argument is the Tapir command. */
export const TAPIR_CALL_TOOL = 'mcp__plugin_archicad-tapir_ArchicadTapir__archicad_call_tool'

export const register: Register = () => {
  // Nothing hooked yet.
}
