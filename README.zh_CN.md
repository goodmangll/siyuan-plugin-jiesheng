# 结绳 · Jiesheng for SiYuan

把思源文档变成任务。用快捷键或侧栏面板设置日期、优先级、提醒、重复，在自带视图里查看，
关掉界面也能收到提醒。

## 模型

**任务 = 思源文档**，带 `custom-task="1"` 才算。子任务 = 子文档，清单 = 笔记本。
其余信息都在块属性里：

| 属性 | 含义 |
|---|---|
| `custom-task` | `1` = 这个文档是任务 |
| `custom-due` · `custom-start` | `yyyyMMdd`（全天）或 `yyyyMMddHHmm` |
| `custom-pri` | `1` 高 · `2` 中 · `3` 低 · 空 = 无 |
| `custom-remind` | 绝对时间 `yyyyMMddHHmm`，空格分隔 |
| `custom-repeat` · `custom-repeat-from` | RRULE 子集 · `due` 或 `done` |
| `custom-done` · `custom-abandoned` | 完成时间 · `1` |
| `custom-pin` · `custom-list` · `custom-spent` | `1` · 清单名 · 番茄数 |

## 快捷键

`Alt+Shift+*` —— 思源已占用 `Alt+1..9` 和 `Ctrl+Alt+1..6`。全部可在 **设置 → 快捷键** 里改；
同样的动作也在块图标右键菜单里。

| 按键 | 动作 |
|---|---|
| `1` `2` `3` `0` | 优先级 高 / 中 / 低 / 清除 |
| `Q` `W` `E` | 截止 今天 / 明天 / 下周 |
| `X` | 清除截止日期 |
| `M` | 完成 / 取消完成 |
| `D` | 打开任务面板 |
| `U` | 置顶 / 取消置顶 |
| `T` | 打开任务视图 |

## 视图与提醒

今天 · 明天 · 未来 7 天 · 收件箱 · 全部 · 已完成，另有看板、日历、四象限、统计，
在插件自己的标签页里打开（`Alt+Shift+T`）。

内核侧守护进程负责 webhook（关掉界面也会推）；前端负责思源内提示和桌面通知。
在插件设置里配。

## 开发

```bash
pnpm install
pnpm test       # 单测
pnpm test:int   # 集成测试（需要思源内核在跑）
pnpm build      # 类型检查 + 打包 + 拷进思源插件目录
```

`scripts/link.mjs` 把产物拷进 `data/plugins/<name>`；**软链接不生效**
（思源的 `os.ReadDir` 不跟随）。

```
src/model/     纯逻辑：date、priority、repeat(RRULE)、remind、attrs、task
src/api/       内核 API（注入 transport，可脱离思源单测）
src/store/     唯一数据源：渲染 = 推导(base 快照, pending 改动)
src/views/     视图层
src/ui/        侧栏面板、块标菜单、设置对话框
src/plugin/    宿主适配器（不依赖 siyuan 包）
src/kernel.ts  提醒守护，单独打包
```

MIT
