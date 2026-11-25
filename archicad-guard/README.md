# archicad-guard

Sits between Claude and Archicad. Claude can read the model freely, but it has to ask you before every change. The mod saves a backup before the first change and keeps a log of every change.

It works with the `archicad-tapir` plugin (the Tapir add-on in Archicad). All of Claude's Archicad work goes through one tool, `archicad_call_tool`, and the `name` of the Tapir command in that call decides what happens.

## What it does

| The call is | What happens |
|---|---|
| a **read** (`elements_get_…`, `project_get_project_info`, `…_find_…`, 370 commands) | runs, not asked, not logged |
| a **view** (zoom, open a window, select, highlight, 20 commands) | runs, not asked, not logged |
| a **change** (everything else, file exports included, 411 commands) | asks you first |
| a name it doesn't know, missing or unreadable | treated as a change: asks |

When it asks, the question shows the command, the project (name and path), the Archicad port, how many elements are touched and, for commands that have a dry run (deletes and 25 others), what the dry run says would happen. The answers are **Stop** (first) and **Go ahead**. It asks every time. There is no "allow for this session".

- **Stop**, closing the question, typing something else, or no one there to answer: the call doesn't run. Claude is told that nothing changed and that it has to ask you before trying again.
- **Go ahead**, on the first change to that project in this session: the project is saved in place, then the `.pln` is copied into the backup folder. If the backup fails, the change is stopped. Then the change runs and is logged.

A dry run that Claude sends itself (`dryRun: true` on a command that has one) runs without asking, because it changes nothing.

## Where backups and the log go

They go in a folder beside the `.pln`, so they sync with the project:

```
<project folder>\archicad-guard\
  backups\<project>_<YYYY-MM-DD_HHMMSS>.pln
  changes.jsonl     one JSON line per change or backup
  CHANGELOG.md      the same, as plain lines
```

Backups are never deleted by the mod. Each log line has the time, the command, the element guids, the result (done, failed, partly failed, still running), the backup file, and "by Claude, approved by Sebastian".

A project that can't be backed up is never changed: untitled, Teamwork, a project whose path Archicad doesn't give, or an Archicad that doesn't answer. The change is stopped without a question and the reason is given.

## Commands

- `/archicad-log [count]`: the last 20 changes (up to 200) in plain words, how many didn't fully go through, and where the log files are.
- `/archicad-restore [number]`: the backups, newest first, and the steps to open one. The mod never restores anything itself.
- Both take a full `.pln` path instead (`/archicad-log D:\path\to\project.pln`) when Archicad isn't running.

Restoring by hand, as `/archicad-restore` explains:

1. Optional: copy today's `.pln` to `<project>_before-restore.pln`.
2. In Archicad: **File > Open > Open…** and open the backup.
3. Right away: **File > Save As…** over `<project>.pln` in the project folder, and choose **Replace**.

## Install

```
claude plugin marketplace add "D:\Architecture Skills\arch-mods"
claude plugin install archicad-guard@arch-mods
```

Then `/reload-plugins`. After a version bump: `claude plugin update archicad-guard@arch-mods`.

## Known gaps

- Two changes at the same moment could both make a backup, or mix their log writes.
- A log over 4 MiB can't be written any more. Claude is told and a toast shows. `/archicad-log` still reads its end.
- The command map is a snapshot of Tapir's 801 commands (2026-11-25). A new Tapir command counts as a change until `scripts/build-command-map.py` is run again.
- Element counts only count `elementId.guid` values in the call. Commands that pick elements another way (for example "all walls on a story") show no count.
- The output of `/archicad-log` and `/archicad-restore` goes to Claude as well as to you.
- A session started by another Claude session (a side session) may not run the mod. Seen 2026-11-25: a change went through there without asking. Make Archicad changes in a normal Code tab session.
- Only the Tapir MCP tools are guarded. Anything that changes the `.pln` some other way (a script, another add-on, you in Archicad) isn't seen.

Checked with `claude plugin validate`, `claude plugin test` and `scripts/typecheck.sh` (`scripts/check.sh` runs all three).
