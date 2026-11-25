# archicad-guard: build plan

Owner: Sebastian
Created: 2026-11-25
Repo: `D:\Architecture Skills\arch-mods` (own local marketplace `arch-mods`, its own git repo). Not part of gg-mods.
Env: Windows 11, Claude desktop app (Code tab), PowerShell 5.1 + Git Bash, no `gh`. Archicad with the Tapir add-on, driven by the `archicad-tapir` plugin (SzamosiMate/tapir-archicad-MCP).

## What it is

A mod that sits between Claude and Archicad. Reading the model always passes. Every change to the model asks Sebastian first, makes a backup before the first change, and is written to a change log (what, when, which elements, asked by whom).

## How to use this plan

Each point is one fresh chat session, done in order. Open a new chat in `D:\Architecture Skills\arch-mods`, paste the master prompt, change only the point number. Too big for one session → split into 1.3a / 1.3b, record it here.

### Master prompt

```
Point: 1.1

We are building the archicad-guard mod. Do the point above from .claude/PLAN.md, and only that point.

1. Read .claude/PLAN.md in full: Ground rules, Decisions, Status, the point, and "What changed" of every done point.
2. Load the plugin-authoring skill. Use gg-mods/live-guard (C:\Users\Sebastian Axente\gg-workbench\gg-mods\live-guard) as the reference for hook structure and tests; copy code, never edit it there.
3. Check git status, the last 10 commits and the Status table. If a needed point is not done or there are uncommitted changes, stop and tell me.
4. Build the point. Real decisions are mine: ask one at a time, three plain options, safe one first, no "(Recommended)" label. Decide the rest and write it in the point's "What changed".
5. plugin validate, plugin test and tsc green before the point is done.
6. Update this plan: "✅ Done <date>" on the point and its Status row, fill "What changed", add "Note from <point>" to later points that need it.
7. Branch, never main. Explicit paths, add and commit joined, push. Ask before merging. Tell me in plain words what changed, what I need to do, and the next point.
```

## Ground rules

- Never test against a real project. Use a scratch .pln copy only, and say which file before any write.
- Fail closed: a command the guard can't classify counts as a change and asks.
- Bump `version` in plugin.json on every change; then `/reload-plugins` (and `claude plugin update archicad-guard@arch-mods` after a bump).
- Tests: vitest maxWorkers 3, kill orphan workers. Python files written with `newline="\n"`.
- No network calls from the mod. Backups and logs stay on this machine.

## Decisions

- 2026-11-25 Home: own marketplace `arch-mods`, not gg-mods (team mods stay untouched).
- 2026-11-25 Strictness: ask on every change to the model; reads pass without asking; every change is logged.
- 2026-11-25 Scope: all Archicad traffic goes through `mcp__plugin_archicad-tapir_ArchicadTapir__archicad_call_tool` (its `name` argument says which command), so that one tool is the main gate. `archicad_get_job`, `archicad_list_commands`, `archicad_get_command_schema`, `discovery_list_active_archicads` and `mcp__archicad-public__GetArchicadInstances` are reads.

## Status

| Point | What | Status |
|---|---|---|
| 1.1 | Repo, marketplace, plugin skeleton | ✅ Done 2026-11-25 |
| 1.2 | Command map (read vs change) + backup method spike | ⬜ |
| 1.3 | The guard: ask on every change | ⬜ |
| 1.4 | Backup before first change + change log | ⬜ |
| 1.5 | `/archicad-guard:log` and `:restore` commands | ⬜ |
| 1.6 | Test in real Archicad on a scratch project, README, v0.1.0 | ⬜ |

## Points

### 1.1 Repo, marketplace, plugin skeleton ✅ Done 2026-11-25
`git init` in arch-mods, `.claude-plugin/marketplace.json`, `archicad-guard/` with plugin.json (0.0.1), hooks.json, an empty `register.ts`, types, one skeleton test. Exclude `.vscode/` in `.git/info/exclude`. Ask Sebastian to create the GitHub repo (private) on github.com and add the remote. Add the marketplace and install it; confirm `claude plugin list` shows it enabled.
What changed:
- `git init` (main = PLAN.md only), work on branch `point-1.1-skeleton`. `.vscode/` in `.git/info/exclude`; `.gitignore` drops `node_modules/`, `*.log`, `*/.claude-plugin/types/` (engine-written types).
- `.claude-plugin/marketplace.json` (`arch-mods`, one plugin). `archicad-guard/`: plugin.json 0.0.1 (author, `types`), `hooks/hooks.json` → `./register.ts`, `register.ts` exports `TAPIR_CALL_TOOL` and an empty `register`, `types/index.d.ts` (empty `PluginState['archicad-guard']`), `tests/skeleton.test.ts`.
- `scripts/check.sh` (validate + test + tsc in one) and `scripts/typecheck.sh` (tsc 5.6.3, tsconfig outside the plugin), adapted from gg-mods. Run `scripts/check.sh` in Git Bash; set `CC_TYPES` if types are not found.
- Marketplace added (user settings) and plugin installed, user scope, read in place from the repo: `claude plugin list` shows `archicad-guard@arch-mods` 0.0.1 enabled.
- Tests run with `claude plugin test` (bun runner), not vitest: no worker limit needed.
- Not done in 1.1: GitHub remote and push wait on Sebastian creating the private repo. README/LICENSE come in 1.6 (validator's directory-only warnings).

### 1.2 Command map + backup spike
Note from 1.1: put the command map in `archicad-guard/hooks/lib/` (a mod cannot import outside its folder); `TAPIR_CALL_TOOL` is already in `register.ts`. Check with `scripts/check.sh`.
Pull the full Tapir command list (`archicad_list_commands`, all groups) and sort every command into **read** or **change**, saved as a data file in the plugin with a test that unknown names count as change. Name rule first (`get_`, `list_`, `find_`, `search_` … = read), then hand-check the rest. Note commands with `dryRun` (e.g. `elements_delete_elements`) so 1.3 can show a preview.
Spike on a scratch project: does `project_save_project` with a path switch the open file to the copy (like Save As)? If yes, find another way (save in place then copy the file on disk, or `project_save_as_module_file` of the touched elements). Write the chosen method in Decisions.
What changed: _(to fill)_

### 1.3 The guard
PreToolUse hook on the Tapir call tool: read → allow; change → ask, with a plain question: command, project name, how many elements, and for deletes the dry-run result. Saying no blocks the call and tells Claude why. Unclear → ask. Tests for each path.
What changed: _(to fill)_

### 1.4 Backup + change log
Before the first approved change in a session, take a backup by the 1.2 method into a backup folder next to the project (location and how many to keep: ask Sebastian). PostToolUse writes one line per change to a log (JSON lines) plus a readable `CHANGELOG.md`: time, command, element guids, result, "by Claude, approved by Sebastian". Failed calls logged as failed.
What changed: _(to fill)_

### 1.5 Commands
`/archicad-guard:log` shows recent changes in plain words. `/archicad-guard:restore` lists backups and gives exact steps to open one (no automatic restore into the live project).
What changed: _(to fill)_

### 1.6 Real test + release
In Archicad on a scratch project: a read passes, a wall move asks, a "no" blocks, a delete shows its preview, the backup appears, the log is right. README (install, what it does, known gaps). Tag v0.1.0.
What changed: _(to fill)_
