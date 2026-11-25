#!/usr/bin/env bash
# Every check a change needs, in one command, stopping at the first failure:
#   claude plugin validate, claude plugin test, tsc (scripts/typecheck.sh), for each mod.
# Usage (Git Bash): scripts/check.sh [archicad-guard ...]
# Set CC_TYPES if typecheck.sh cannot find the Claude Code API types by itself.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
if [ $# -eq 0 ]; then plugins=(archicad-guard); else plugins=("$@"); fi

fail() { echo "✗ $*" >&2; exit 1; }

for p in "${plugins[@]}"; do
  echo "== $p: validate"
  claude plugin validate "$p" || fail "$p: validate"
  echo "== $p: test"
  claude plugin test "$p" || fail "$p: test"
done

echo "== tsc"
./scripts/typecheck.sh "${plugins[@]}" || fail "tsc"

echo "✓ all checks green: ${plugins[*]}"
