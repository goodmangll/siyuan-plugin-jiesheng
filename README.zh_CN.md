# Task Flow for SiYuan · 任务流

Quick-set task attributes — **due date, priority, reminder, repeat** — with keyboard shortcuts and a side panel.

> Status: **M1 (model + commands + entry) done.** The editable panel is M2.

## Why

SiYuan already has the pieces: native task blocks, QueryView dashboards, a task list dock.
What's missing is the *fast* part — giving a task a date/priority without opening the block-attribute
dialog and typing `20260925` by hand.

Task Flow adds exactly that, and nothing else. **It does not add any view.**

## Data model

Tasks are ordinary SiYuan task-list blocks (`- [ ] …`). Everything is stored in block attributes:

| attribute | meaning | format |
|---|---|---|
| `custom-due` | due | `yyyyMMdd` (all-day) or `yyyyMMddHHmm` |
| `custom-start` | start | same |
| `custom-pri` | priority | `1` high · `2` medium · `3` low · empty = none |
| `custom-remind` | reminders | absolute `yyyyMMddHHmm`, space-separated |
| `custom-repeat` | repeat rule | RRULE subset, e.g. `FREQ=WEEKLY;BYDAY=FR` |
| `custom-list` | lightweight list name | text |
| `custom-done` | completion time | `yyyyMMddHHmm` |
| `custom-abandoned` | abandoned | `1` |
| `custom-spent` | pomodoros spent | number |

Completion itself stays native: `- [ ]` / `- [X]`. No extra attribute.

Sub-tasks are nested `- [ ]` blocks. Notes are documents (convert with SiYuan's built-in
`li2Doc`), matching a similar product's own task/note split.

## Shortcuts

SiYuan already occupies `Alt+1..9` (docks) and `Ctrl+Alt+1..6` (headings), so `Alt+Shift+*` is used:

| key | action |
|---|---|
| `Alt+Shift+1/2/3` | priority high / medium / low |
| `Alt+Shift+0` | clear priority |
| `Alt+Shift+Q / W / E` | due today / tomorrow / next week (keeps all-day vs. timed form) |
| `Alt+Shift+X` | clear due date |
| `Alt+Shift+M` | toggle done |
| `Alt+Shift+D` | open the task panel |

All rebindable in **Settings → Keymap**.

## Develop

```bash
pnpm install
pnpm test            # unit tests
pnpm test:int        # integration tests against a running SiYuan kernel
pnpm build           # typecheck + bundle + copy into the SiYuan plugins dir
```

`scripts/link.mjs` copies the build into `data/plugins/<name>`. A symlink does **not** work
(SiYuan's `os.ReadDir` does not follow them).

## Layout

```
src/model/     pure logic: date, priority, repeat (RRULE), remind, attrs, task
src/api/       kernel API (transport-injected, so it is unit-testable off-SiYuan)
src/commands/  shortcuts -> attribute writes (deps-injected, fully unit-tested)
src/ui/        dock panel
src/plugin.ts  wiring only
```

See `TESTS.md` for the acceptance checklist and the docs in the parent knowledge base for the
design rationale and the M0 feasibility findings.

## License

MIT
