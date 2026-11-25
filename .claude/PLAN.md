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
- 2026-11-25 Backup method (1.2): save the project in place (`project_save_project`, no path), then copy the .pln into the backup folder on disk. Not Save As: Tapir's docs say `project_save_project` with a path and `project_save_project_as_archive` both switch the open project to the copy. A project that can't be saved in place (Teamwork, read-only, untitled) gets no backup, so the change is blocked.
- 2026-11-25 Backup and log place (1.4): one `archicad-guard` folder beside the .pln (so it lives in the project's Synology folder): `backups/<project>_<YYYY-MM-DD_HHMMSS>.pln`, `changes.jsonl`, `CHANGELOG.md`. Backups are never deleted by the mod.
- 2026-11-25 Three kinds, not two: **read** (passes), **view** = screen or selection only (zoom, window, select, highlight, alerts: passes, not logged), **change** = everything else, file exports included (asks). Unknown names are change.

## Status

| Point | What | Status |
|---|---|---|
| 1.1 | Repo, marketplace, plugin skeleton | ✅ Done 2026-11-25 |
| 1.2 | Command map (read vs change) + backup method spike | ✅ Done 2026-11-25 |
| 1.3 | The guard: ask on every change | ✅ Done 2026-11-25 |
| 1.4 | Backup before first change + change log | ✅ Done 2026-11-25 |
| 1.5 | `/archicad-log` and `/archicad-restore` commands | ✅ Done 2026-11-25 |
| 1.6a | Live check of reads and the guard (headless), README | ✅ Done 2026-11-25 |
| 1.6b | Live Go ahead test in a normal session, v0.1.0 | ✅ Done 2026-11-25 |

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

### 1.2 Command map + backup spike ✅ Done 2026-11-25
Note from 1.1: put the command map in `archicad-guard/hooks/lib/` (a mod cannot import outside its folder); `TAPIR_CALL_TOOL` is already in `register.ts`. Check with `scripts/check.sh`.
Pull the full Tapir command list (`archicad_list_commands`, all groups) and sort every command into **read** or **change**, saved as a data file in the plugin with a test that unknown names count as change. Name rule first (`get_`, `list_`, `find_`, `search_` … = read), then hand-check the rest. Note commands with `dryRun` (e.g. `elements_delete_elements`) so 1.3 can show a preview.
Spike on a scratch project: does `project_save_project` with a path switch the open file to the copy (like Save As)? If yes, find another way (save in place then copy the file on disk, or `project_save_as_module_file` of the touched elements). Write the chosen method in Decisions.
What changed:
- Branch `point-1.2-command-map`. plugin.json 0.0.2.
- `scripts/tapir-commands.txt`: the full Tapir list (801 commands, `archicad_list_commands` with no keywords, 2026-11-25). `scripts/build-command-map.py` sorts it and writes `archicad-guard/hooks/lib/commands.ts` (generated, don't edit): 370 read, 20 view, 411 change, 26 with `dryRun`. Rule: the verb after the group prefix (`get`, `find`, `search`, `is`, `compare`, `measure`, `read`, `interpret`, `calculate`, `can`) = read; hand lists in the script for the rest (10 extra reads such as `elements_query`, `app_convert_images`; the 20 view commands). Doubtful ones stay change: `library_check_libraries`, `elements_regularize_polygons`, `elements_capture_element_state`, `app_set_current_window_drawing_scale`, `navigator_set_view_rotation`, hierarchical edit mode.
- `archicad-guard/hooks/lib/command-kind.ts`: `kindOf(name)` → `read | view | change` (exact name only; missing, non-string, wrong case or unknown → change), `takesDryRun(name)`, `isKnownCommand(name)`. Tests in `tests/command-kind.test.ts`: fail-closed cases, samples of each kind, each command in exactly one list (801), dryRun ⊂ change, no read has a change verb.
- dryRun list taken from the commands' Tapir descriptions ("With dryRun true …"); the search ranks by relevance, so it may miss a few. A missed one only means no preview, still asks.
- Spike: Archicad wasn't running, so not tested live. Answered from the Tapir schemas instead (see Decisions). New Tapir commands: refresh the txt, rerun the script, read the diff.
- `register.ts` unchanged: the map isn't hooked up yet (1.3).

### 1.3 The guard ✅ Done 2026-11-25
Note from 1.2: `kindOf` / `takesDryRun` in `hooks/lib/command-kind.ts`. `view` passes like read and is not logged. For the dry-run preview call Tapir again with `params.dryRun: true` only if the mod can (it has no MCP access of its own); otherwise tell Claude to run the dry run first and show it. The Tapir call tool takes `{ name, arguments: { port, params } }`; check the `tool.call` event shape in the types for where that input sits.
PreToolUse hook on the Tapir call tool: read → allow; change → ask, with a plain question: command, project name, how many elements, and for deletes the dry-run result. Saying no blocks the call and tells Claude why. Unclear → ask. Tests for each path.
What changed:
- Branch `point-1.3-guard`. plugin.json 0.0.3. No questions for Sebastian: the plan already settled them.
- `hooks/lib/guard.ts` (no `$`): `gateOf(e)` → pass or ask; reads `{ tool, name, arguments: { port, params } }` straight off the `tool.call` event (MCP arguments sit at the top of `e`; `arguments` as a JSON string is read too). Element count = distinct `elementId.guid` anywhere in `params`. Question wording, preview cut (600 chars), deny text. `TAPIR_CALL_TOOL` moved here, still re-exported from `register.ts`.
- `hooks/register.ts`: one `tool.call` hook. read/view → pass. change → asks `Stop` / `Go ahead` (Stop first), header `Archicad`, every time (no "allow for session": Decisions say ask on every change). Question lines: command, project (name + path, Teamwork / untitled noted), port, element count, dry-run result. Anything but `Go ahead` (Stop, dismissed, free text, no one to ask) denies with `archicad-guard stopped this: <why>. Nothing was changed in Archicad. Ask the user before trying again.`
- The mod CAN call Tapir itself: `$.mcp.call('plugin:archicad-tapir:ArchicadTapir', 'archicad_call_tool', { name, arguments })`. Used for `project_get_project_info` (port from the call) and, for `takesDryRun` commands, the same call with `params.dryRun: true`. 4 s timeout, then the question goes out without that line ("could not be read" / "Dry run could not be shown: …"). The timeout sleep is cancelled once Archicad answers: `$.clock.sleep` is the one `$` call that counts against the hook's 10 s budget.
- My calls: a dry run Claude sends itself (`params.dryRun === true` on a `takesDryRun` command) passes without asking (Tapir: changes nothing, no undo step); `dryRun` on any other command still asks. Any other tool of the two Archicad servers not in the Decisions read list asks (generic question). Unclear call (no name, unreadable arguments, guard error) → asks; a guard that throws or overruns its budget → `.catch` denies Archicad calls (validate: "gating hook with .catch").
- Tests: `tests/guard.test.ts` (gate, guid count, project text, preview) and `tests/hook.test.ts` through the engine with a fake Tapir on `mcp.call` and a recording bottom `tool.call`: read, view, change+Stop, Go ahead, asks again each time, delete dry run (sent with `dryRun: true`, shown), failed dry run, Archicad down, Archicad slow (timeout), Claude's own dry run, unknown/missing/unreadable, JSON-string args, no one to ask / odd answer, other Archicad tools. 24 pass. Tests hold `clock.sleep` (the test clock resolves it at once).
- Not tested live: Archicad not used in this point (1.6).


### 1.4 Backup + change log ✅ Done 2026-11-25
Note from 1.3: hook it into `decide` in `register.ts`: back up right after a `Go ahead`, before `next(e)`; log after `await next(e)` in the same hook (no separate PostToolUse needed). `projectOf` already returns `isUntitled` / `isTeamwork` / path from `project_get_project_info`, and `tapir()` calls any Tapir command (4 s timeout; `project_save_project` may need longer). `elementGuidsOf(params)` gives the guids for the log. Keep `.catch` fail-closed. Dry runs pass unlogged.
Note from 1.2: method is save in place, then copy the .pln (Decisions). Find the project's path first (check `project_get_project_info` / `teamwork_get_teamwork_project_info` schemas); Teamwork, read-only or untitled → no backup → block the change and say why. Never pass a path to `project_save_project`.
Before the first approved change in a session, take a backup by the 1.2 method into a backup folder next to the project (location and how many to keep: ask Sebastian). PostToolUse writes one line per change to a log (JSON lines) plus a readable `CHANGELOG.md`: time, command, element guids, result, "by Claude, approved by Sebastian". Failed calls logged as failed.
What changed:
- Branch `point-1.4-backup-log` (from `point-1.3-guard`). plugin.json 0.0.4. Sebastian chose: everything beside the .pln in `archicad-guard/`, keep all backups (Decisions).
- `hooks/lib/record.ts` (no `$`): `placeOf(project)` → folder/backups/jsonl/md or why not; path helpers keep the path's own separator; `backupNameOf` (local time, `-2` … when taken); `COPY_SCRIPT`; `savedOf` (save answer, running job), `outcomeOf` (done / failed / partly failed from `executionResults` / still running); log entries and the CHANGELOG line.
- `register.ts` `decide`: a change first needs a place. No project (Archicad slow or down, no port, unreadable args), untitled, Teamwork or no path → stopped **without a question** (nothing to back up). Other Archicad tools that aren't the Tapir call (1.3 asked) are now stopped the same way: no project to back up or log. The question gains a line: `Before it runs: the project is saved, then copied to <backups>.` or `Backup: already made this session (<file>).`
- After `Go ahead`, first change for that project this session: `project_save_project` with `params: {}` (no timer: `$.mcp.call` doesn't count against the budget); a `status: running` answer is polled with `archicad_get_job` up to 10 times. Then the copy: `$.process.run` PowerShell `[System.IO.File]::Copy(src, dst, $false)` with the paths in env vars (AG_SRC/AG_DIR/AG_DST), 10 min timeout; the copy's size must equal the .pln's (`$.fs.stat`). Any failure → change stopped, says why. The backup goes into `$.state` `backups` (project key → file; contract in `types/index.d.ts`) and the log gets a `backup` entry.
- After `next(e)`: one `change` entry (ISO time, command, tool, port, project, all guids, status, detail, backup, "by Claude, approved by Sebastian") to `changes.jsonl` and a plain line to `CHANGELOG.md`. `$.fs` has no append: the file is read and written whole. A log that can't be written: the change already ran, so Claude gets it in `context` and a toast shows.
- Reads, views and dry runs: no backup, no log. A "Stop": nothing saved, copied or written.
- Tests: `tests/record.test.ts` (7) and 14 new in `tests/hook.test.ts` with a fake disk (`fs.*`), fake copy (`process.run`) and fixed `clock.now`. Found: the engine hands `fs` paths to hooks with backslashes on Windows. 45 pass.
- Known gaps: two changes at once could both back up or interleave log writes; a log over 4 MiB can't be read (`$.fs.read` limit) and then fails to write (Claude is told). Not tested live (1.6).

### 1.5 Commands ✅ Done 2026-11-25
Note from 1.4: read the log from `<folder of the .pln>/archicad-guard/changes.jsonl` (`kind: 'change' | 'backup'`, types in `hooks/lib/record.ts`); `placeOf(projectInfoOf(...))` gives the paths, `project_get_project_info` needs a port (`discovery_list_active_archicads`). Backups are `archicad-guard/backups/*.pln`; this session's are in `$.state` `backups`.
`/archicad-guard:log` shows recent changes in plain words. `/archicad-guard:restore` lists backups and gives exact steps to open one (no automatic restore into the live project).
What changed:
- Branch `point-1.5-commands` (from `point-1.4-backup-log`). plugin.json 0.0.5. No questions for Sebastian.
- Names: `/archicad-log` and `/archicad-restore`, not `/archicad-guard:log`: a command a mod registers may only hold letters, digits, `_`, `-`. Registered at `session.start` with literal names (validate: "answers its own command"), `immediate` (they only read, so they run mid-turn too).
- `hooks/lib/history.ts` (no `$`): `argsOf` (nothing, a number, or a full `.pln` path, quotes dropped; anything else → usage), `portsOf` (`active[].port` of `discovery_list_active_archicads`, never `unavailable`), `entriesOf` (bad lines counted, not shown), `logText`, `timeOfName`/`sortBackups` (newest first by the time in the name), `restoreText`, `projectPathOfSession` (gets the path's spelling back from the backup path: the state key is lower case).
- Which project: a `.pln` path given → that one (no Archicad needed). Else every running Archicad (`discovery_list_active_archicads`, then `project_get_project_info` per port, 3 s each, so ≤ 6 s of the hook's budget), plus the projects this session backed up (`$.state` `backups`). Untitled/Teamwork are a note under the answer. None at all → says so and shows `/archicad-log D:\path\to\project.pln`.
- `/archicad-log [count]`: last 20 (max 200) entries, oldest first, as the CHANGELOG.md lines (`mdLineOf`), how many did not fully go through, unreadable lines, where CHANGELOG.md and changes.jsonl are. A log over 1 MiB: only its end is read (`$.fs.read` offset), so the 4 MiB limit from 1.4 no longer blocks reading.
- `/archicad-restore [number]`: the `.pln` files in `backups/`, newest first (15 shown), size, "made this session"; steps for backup 1 (or the number): optional copy of today's .pln to `<project>_before-restore.pln`, File > Open the backup, at once File > Save As over `<project>.pln` in the project folder (Replace), and don't let Claude change the backup file itself. Nothing is restored, saved, copied or written by the mod.
- Tests: `tests/history.test.ts` (6) and `tests/commands.test.ts` (9, through the engine: fake Archicad and disk, checks nothing is written, run or changed). 60 pass.
- Known gaps: the restore steps' Archicad menu names are from memory (check in 1.6); the output text goes to Claude as well as to Sebastian.

### 1.6a Real test, part 1 ✅ Done 2026-11-25
Split 2026-11-25: the side session that ran 1.6 doesn't run the mod, so the Go ahead test moved to 1.6b (Sebastian's choice).
Note from 1.3: confirm live: `$.mcp.call` reaches Tapir by the name `plugin:archicad-tapir:ArchicadTapir`; the field names of `project_get_project_info` (`projectName`, `projectPath`/`projectLocation`, `isUntitled`, `isTeamwork`) show in the question; a delete's dry-run text reads well (cut at 600 chars); a slow Archicad still gets the question out.
Note from 1.5: confirm live: `discovery_list_active_archicads` answers `{ active: [{ port }] }` (`portsOf`); `/archicad-log` and `/archicad-restore` show in the menu and answer on the scratch project; the restore steps' menu names (File > Open > Open…, File > Save As…, Replace) match Archicad, and a Save As over the original works with the backup open. README: the commands are `/archicad-log` and `/archicad-restore`.
Note from 1.4: confirm live: `project_save_project` with `params: {}` answers in a shape `savedOf` reads (success, or a running job with a handle field it knows: `jobHandle`/`job_handle`/`handle`/`jobId`); `powershell.exe` copies the .pln while Archicad has it open; the backup and CHANGELOG.md appear beside the .pln and sync in Synology; the change result shape gives the right status in the log.
Note from 1.2: also confirm live on the scratch copy that a plain `project_save_project` keeps the same file open and that the .pln can be copied while Archicad has it open.
In Archicad on a scratch project: a read passes, a wall move asks, a "no" blocks, a delete shows its preview, the backup appears, the log is right. README (install, what it does, known gaps). Tag v0.1.0.
What changed (branch `point-1.6-release` from `point-1.5-commands`):
- Scratch project: `C:\Users\Sebastian Axente\Desktop\ROtemplate29\Kreg-template_v0.6_BACKUP.pln` (Save As copy of the Kreg template, port 19723, Archicad 30, Tapir 2.0.1). Almost empty: no walls, one editable element (`5786CE14-EB6F-4AD1-9378-884D0D080A9F`).
- Found live: `discovery_list_active_archicads` answers `{ activeInstances: [{ port, projectName, projectPath, … }], unavailableInstances: [{ reason, message }] }`, not `active`/`unavailable`. `portsOf` read none of it: fixed (reads `activeInstances`, then `active`; skips every `unavailable…` key), tests added.
- Confirmed live: `project_get_project_info` fields are `projectName`, `projectPath`, `projectLocation`, `isUntitled`, `isTeamwork` (as `projectInfoOf` reads). It refuses `params: {}` (the mod sends none there: right). `project_save_project` requires `params` (the backup's `params: {}` is right).
- Confirmed live (headless `claude -p`, debug log): the mod loads (tier user, admitted, both commands listed); a change is caught, `$.mcp.call` reaches Tapir by `plugin:archicad-tapir:ArchicadTapir` (1.1 s), and with no one to ask it is denied with the stop text. Nothing moved.
- Found: the session started from another session (side session) does **not** run the mod: a move there went through unasked (the scratch element moved +1 m in x, not moved back). The live Go ahead test needs a normal Code tab session.
- README: `archicad-guard/README.md` (install, kinds, question, backups and log, commands, restore steps, known gaps).
- plugin.json stays 0.0.5; 1.6b bumps to 0.1.0. Tests: 60 pass (live-shape cases added inside the `portsOf` test).

### 1.6b Real test, part 2 + release ✅ Done 2026-11-25
Note from 1.6a: run in a **normal** Code tab session, not one started by another session (those don't run the mod). First confirm the mod runs: `/archicad-log` must show in the menu. Scratch copy: `C:\Users\Sebastian Axente\Desktop\ROtemplate29\Kreg-template_v0.6_BACKUP.pln`; check with `discovery_list_active_archicads` that it (not the template) is open, and say the file before any write. Its one editable element `5786CE14-EB6F-4AD1-9378-884D0D080A9F` was moved +1 m in x unguarded in 1.6a: use it for the move test (move it back). No walls in it: for the delete preview draw a throwaway line or wall in the copy first. The `archicad-guard\` folder will be created in `ROtemplate29` beside the copy.
Note from 1.6a (still open from 1.2–1.5): `project_save_project` `params: {}` answer shape (`savedOf`); PowerShell copy of the open .pln; delete dry-run text (600-char cut); log status from the move's `executionResults`; restore menu names (File > Open > Open…, File > Save As…, Replace) and a Save As over the original with the backup open.
In Archicad, scratch copy: a change asks, Stop blocks, Go ahead backs up then runs, the log is right, a delete shows its preview, `/archicad-log` and `/archicad-restore` answer. Fix what's found, update README. plugin.json 0.1.0, `claude plugin update archicad-guard@arch-mods`, tag v0.1.0.
What changed (branch `point-1.6-release`, normal Code tab session, scratch copy above, port 19723):
- Mod runs in a normal session (0.0.5 enabled; the first change asked).
- Confirmed live: a read (`project_get_project_info`) passes unasked. Move of `5786CE14…` −1 m x (back where it was): Stop → denied with the stop text, nothing moved; again, Go ahead → `project_save_project` `params: {}` answered in a shape `savedOf` reads, PowerShell copied the open .pln (44.3 MB, sizes equal, under a second), the move ran, `executionResults: [{success:true}]` → `done`. `ROtemplate29\archicad-guard\` holds `backups\Kreg-template_v0.6_BACKUP_2026-11-25_142627.pln`, `changes.jsonl` (backup + change), `CHANGELOG.md`. A second change (throwaway wall) made no second backup. Delete of that wall: the question showed the dry-run result (Sebastian: reads fine); Stop → not logged.
- Found and fixed: a created element was logged as "no elements named" (its guid is only in Archicad's answer). `answerJsonOf` in `record.ts`; the log takes the call's guids plus those in the answer of a change that ran (not of a failed one). 2 tests; 62 pass.
- Left in the scratch copy: test wall `8310AA3C-A747-4500-956E-F3634348B5EA` at (100,100)–(103,100); Sebastian deletes it by hand.
- plugin.json 0.1.0, `claude plugin update archicad-guard@arch-mods` done (applies after restart / `/reload-plugins`). README: guids from the answer, "Tested live" section.
- Confirmed live by Sebastian after `/reload-plugins`: `/archicad-log` (3 entries, paths) and `/archicad-restore` (1 backup, steps) answer on the scratch copy. The "1 error during load" in `/reload-plugins` is the duplicate `archicad-tapir` (claude.ai copy loses to the local one), not this mod.
- Not checked in Archicad: the restore steps' menu names and a Save As over the original with the backup open (README known gap). The wall created before this fix stays "no elements named" in the scratch log.
- Tag `v0.1.0` on `point-1.6-release`.
