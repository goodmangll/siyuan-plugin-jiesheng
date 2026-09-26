# Jiesheng · 结绳

Turn SiYuan documents into tasks. Set date, priority, reminder and repeat with shortcuts or a
side panel, browse them in built-in views, and get reminders with the UI closed.

## Model

A task is **a SiYuan document** marked `custom-task="1"`. Sub-tasks are sub-documents, the list
is the notebook. Everything else is a block attribute:

| attribute | meaning |
|---|---|
| `custom-task` | `1` = this document is a task |
| `custom-due` · `custom-start` | `yyyyMMdd` (all-day) or `yyyyMMddHHmm` |
| `custom-pri` | `1` high · `2` medium · `3` low · empty = none |
| `custom-remind` | absolute `yyyyMMddHHmm`, space-separated |
| `custom-repeat` · `custom-repeat-from` | RRULE subset · `due` or `done` |
| `custom-done` · `custom-abandoned` | completion timestamp · `1` |
| `custom-pin` · `custom-list` · `custom-spent` | `1` · list name · pomodoros |

## Shortcuts

`Alt+Shift+*` — SiYuan already takes `Alt+1..9` and `Ctrl+Alt+1..6`. Rebindable in
**Settings → Keymap**; the same actions sit on the block-icon right-click menu.

| key | action |
|---|---|
| `1` `2` `3` `0` | priority high / medium / low / clear |
| `Q` `W` `E` | due today / tomorrow / next week |
| `X` | clear due date |
| `M` | toggle done |
| `D` | open the task panel |
| `U` | pin / unpin |
| `T` | open the task views |

## Views & reminders

Today · Tomorrow · Next 7 days · Inbox · All · Done, plus Kanban, Calendar, Matrix, Stats — in a
plugin tab (`Alt+Shift+T`).

The kernel daemon pushes webhooks (works with the UI closed); the front end adds in-app toasts
and desktop notifications. Configure in the plugin settings.

## Develop

```bash
pnpm install
pnpm test       # unit tests
pnpm test:int   # integration tests against a running SiYuan kernel
pnpm build      # typecheck + bundle + copy into the SiYuan plugins dir
```

`scripts/link.mjs` copies the build into `data/plugins/<name>`; a symlink does **not** work
(SiYuan's `os.ReadDir` doesn't follow them).

```
src/model/     pure logic: date, priority, repeat (RRULE), remind, attrs, task
src/api/       kernel API (transport-injected → unit-testable off-SiYuan)
src/store/     the single data source: render = derive(base, pending)
src/views/     the view layer
src/ui/        dock panel, block menu, settings dialog
src/plugin/    host adapters (no siyuan-package dependency)
src/kernel.ts  reminder daemon, bundled separately
```

MIT
