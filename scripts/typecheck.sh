#!/usr/bin/env bash
# Type-checks one plugin (default: archicad-guard) with tsc 5.6.3, using a tsconfig kept OUTSIDE the plugin folder.
# Adapted from gg-mods/scripts/typecheck.sh.
# Usage: scripts/typecheck.sh [archicad-guard]
#
# The Claude Code API types come from, in order:
#   1. $CC_TYPES (a claude-code/index.d.ts or claude-code.d.ts file),
#   2. <plugin>/.claude-plugin/types/claude-code/index.d.ts (the engine writes it once it has loaded the mod),
#   3. the newest plugin-authoring skill's types/claude-code.d.ts found under the temp folder or ~/.claude.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && { pwd -W 2>/dev/null || pwd; })"
if [ $# -eq 0 ]; then plugins=(archicad-guard); else plugins=("$@"); fi
status=0

find_types() {
  local plugin="$1"
  if [ -n "${CC_TYPES:-}" ]; then echo "$CC_TYPES"; return; fi
  if [ -f "$here/$plugin/.claude-plugin/types/claude-code/index.d.ts" ]; then
    echo "$here/$plugin/.claude-plugin/types/claude-code/index.d.ts"; return
  fi
  ls -t /tmp/*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
        "${TEMP:-/tmp}"/claude/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts \
        "$HOME"/.claude/**/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1 || true
}

for plugin in "${plugins[@]}"; do
  types="$(find_types "$plugin")"
  if [ -z "$types" ]; then echo "No Claude Code types found for $plugin. Set CC_TYPES." >&2; exit 2; fi
  # Git Bash: tsc runs as a Windows program and cannot read a `/tmp/...` path, so hand it `C:/...` instead.
  if command -v cygpath >/dev/null 2>&1; then types="$(cygpath -m "$types")"; fi
  tmp="$(mktemp -d)"
  cat > "$tmp/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": ["$types", "$here/$plugin/hooks", "$here/$plugin/types", "$here/$plugin/tests"]
}
JSON
  echo "tsc: $plugin"
  npx -y -p typescript@5.6.3 tsc -p "$tmp/tsconfig.json" || status=1
  rm -rf "$tmp"
done
exit $status
