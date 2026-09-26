/**
 * 思源插件入口。
 *
 * 这一层只做「接线」：把 commands / api / ui 三块拼到思源的 Plugin 生命周期上。
 * 所有可测的逻辑都在下层，这里不做判断。
 */
import { Plugin, fetchSyncPost, getActiveEditor, openTab, showMessage } from "siyuan";
import {
    deleteBlock, getBlockKramdown, getTaskAttrs, getTaskTitle,
    resolveTaskBlock, setBlockAttrs, setTransport, updateBlockMarkdown,
} from "./api/blocks";
import { countSelectedBlocks } from "./api/dom";
import {
    childTasksOf, createSubTask, detachTask, ensureTaskNotebook, linkTaskUnder, sanitizeTitle,
    setAttrsAndWait,
} from "./api/views";
import { callKernel, createDocWithMd, runSql } from "./api/blocks";
import { mountTab, type TabHandle } from "./views/mountTab";
import { calendarSql, countSql, listsSql, remindCandidatesSql, smartListIds, sqlForView, type SmartListId } from "./views/query";
import {
    createdTrendSql, doneTrendSql, fillSeries, listDistSql, priorityDistSql, recentDays,
} from "./views/stats";
import { toViewTasks, type TaskRow } from "./views/model";
import type { ViewHost, ViewId } from "./views/host";
import { patchList, patchPriority, patchRange } from "./ui/panelActions";
import { toDateStr } from "./model/date";
import { ATTR } from "./model/attrs";
import { splitTaskBlock } from "./model/body";
import { createFollowScheduler, nextPinned, selectionIsInEditor } from "./ui/follow";
import { runReminderScan } from "./ui/reminderRunner";
import { DEFAULT_SETTINGS, type TaskFlowSettings } from "./settings";
import { loadSettings, saveSettings } from "./api/settings";
import { openSettingsDialog } from "./ui/settingsDialog";
import { toDateTimeStr } from "./model/date";
import { cursorBlockId, taskBlockIdFromElement, type ProtyleLike } from "./api/dom";
import type { KernelResponse } from "./api/blocks";
import { COMMANDS, type TaskCommandDeps } from "./commands";
import { mountTaskPanel, type TaskPanelHandle } from "./ui/mountPanel";
import { buildBlockMenuItems, type BlockMenuDeps } from "./ui/blockMenu";
import { generateNextRepeat, type GenerateDeps } from "./generate";


/** 某天的次日（日期区间的上界用） */
function plusOneDay(day: string): string {
    const y = Number(day.slice(0, 4)), m = Number(day.slice(4, 6)), d = Number(day.slice(6, 8)) + 1;
    const t = new Date(y, m - 1, d);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}`;
}

const TAB_TYPE = "taskFlowTab";
const DOCK_TYPE = "taskFlowDock";
const NOT_READY = "任务流：插件仍在初始化，请稍后再试";

const ICON = '<symbol id="iconTaskFlow" viewBox="0 0 32 32">'
    + '<path d="M7 5h18a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 5v2h14v-2H9zm0 5v2h10v-2H9zm0 5v2h7v-2H9z"/>'
    + "</symbol>";

export default class TaskFlow extends Plugin {
    private panel: TaskPanelHandle | null = null;
    private tab: TabHandle | null = null;
    /** 视图里点了某张卡片后要固定在面板上的任务；在编辑器里点一下即解除 */
    private pinnedTask: string | null = null;
    private transportReady = false;

    async onload(): Promise<void> {
        // transport：思源的 fetchPost 返回的是 data 本身，不是 {code,msg,data} 信封（M0 实测），
        // 这里把它重新包成 api 层期望的形状。
        // ⚠️ 必须用 fetchSyncPost：`fetchPost(url, data)` 在**不带回调**时 resolve 的是 undefined
        //    （真机踩到的坑，M0 探针里也出现过同样现象）。
        //    fetchSyncPost 才返回 {code, msg, data} 信封。
        const post = fetchSyncPost as unknown as (url: string, data?: unknown) => Promise<KernelResponse>;
        setTransport(async (url, data) => await post(url, data ?? {}));
        this.transportReady = true;

        this.addIcons(ICON);

        const deps = this.buildDeps();
        for (const cmd of COMMANDS) {
            this.addCommand({
                langKey: cmd.langKey,
                langText: cmd.langText,
                hotkeys: cmd.hotkeys,
                execute: () => {
                    void cmd.run(deps).catch((e) => {
                        // 命令出错不能让编辑器崩：提示一下就行
                        showMessage("任务流：" + ((e as Error).message || "执行失败"), 5000, "error");
                    });
                },
            });
        }

        // 光标在编辑器里移动时，面板跟着换任务。
        //
        // ⚠️ 真机验证发现：**点编辑器不会触发 `click-editorcontent`**
        //    （点完面板纹丝不动，按 ⌥⇧D 显式刷新才更新），所以不能只靠它。
        //    改用更可靠的组合：DOM 的 selectionchange（光标一动就发）
        //    + 思源的 switch-protyle（切文档）。防抖见 ui/follow。
        const follow = createFollowScheduler(async (reason) => {
            const sel = window.getSelection();
            const node = sel?.anchorNode ?? null;
            if (!selectionIsInEditor(node)) {
                // 在面板自己的输入框里选字，不该刷新，也不该解除固定
                this.pinnedTask = nextPinned(this.pinnedTask, "selection-outside-editor");
                return;
            }
            // 判据是「光标**换了个块**（或切了文档）」，
            // 不是「点了哪里」—— 见 ui/follow.ts 里那段自噬 bug 的记录。
            const caret = this.currentBlockId();
            const moved = reason === "switch-doc" || caret !== this.lastCaretBlockId;
            this.lastCaretBlockId = caret;
            this.pinnedTask = nextPinned(this.pinnedTask, moved ? "caret-moved" : "caret-same");
            this.panel?.refresh();
        });
        document.addEventListener("selectionchange", () => follow.poke("caret"), true);
        this.eventBus.on("switch-protyle", () => follow.poke("switch-doc"));
        this.eventBus.on("click-editorcontent", () => follow.poke("caret"));

        // 块标菜单 →「任务 ▸」子菜单
        // ⚠️ 必须同步 addItem：事件返回后思源立刻渲染菜单，异步加的项不会出现。
        this.eventBus.on("click-blockicon", (event) => {
            try {
                const { menu, blockElements } = event.detail;
                const taskId = taskBlockIdFromElement(blockElements?.[0] ?? null);
                const items = buildBlockMenuItems(taskId, this.buildBlockMenuDeps());
                if (!items.length) {
                    return;
                }
                menu.addSeparator();
                menu.addItem({
                    icon: "iconTaskFlow",
                    label: "任务",
                    type: "submenu",
                    submenu: items.map((it) => ({
                        icon: it.icon,
                        label: it.label,
                        click: () => {
                            void it.click();
                        },
                    })),
                });
            } catch {
                /* 挂菜单失败不能影响思源的块标菜单本身 */
            }
        });

        try {
            this.addDock({
                id: DOCK_TYPE,
                type: DOCK_TYPE,
                config: {
                    position: "RightBottom",
                    size: { width: 320, height: 420 },
                    icon: "iconTaskFlow",
                    title: "任务信息",
                },
                data: {},
                init: (custom) => {
                    const el = custom?.element as HTMLElement | undefined;
                    if (!el) {
                        return;
                    }
                    this.panel = mountTaskPanel(el, this.buildPanelHost());
                },
            });
        } catch (e) {
            showMessage("任务流：侧栏面板注册失败 —— " + (e as Error).message, 6000, "error");
        }

        // 全屏 Tab：视图层的画布。Dock 侧栏放不下看板的横排多列与日历的 7 列网格。
        try {
            this.addTab({
                type: TAB_TYPE,
                init: (custom) => {
                    const el = (custom?.element ?? (this as unknown as { element?: HTMLElement }).element) as HTMLElement | undefined;
                    if (!el) {
                        showMessage("任务流：Tab 容器拿不到", 5000, "error");
                        return;
                    }
                    this.tab = mountTab(el, this.buildViewHost());
                },
                destroy: () => {
                    this.tab?.unmount();
                    this.tab = null;
                },
            });
        } catch (e) {
            showMessage("任务流：Tab 注册失败 —— " + (e as Error).message, 6000, "error");
        }

        // ── 前端提醒：思源内提示 + 桌面通知 ──
        // 内核不能弹通知（goja 没有 DOM），所以这一段必须在前端跑。
        // 两边各有游标是**刻意的**：界面关着时前端不跑，共用游标会导致
        // 关了三天再打开被历史提醒刷屏。
        try {
            await this.loadSettingsOnce();
            this.startReminderScan();
        } catch (e) {
            showMessage("任务流：提醒启动失败 —— " + (e as Error).message, 5000, "error");
        }

    }

    /** 打开任务 Tab */
    private openTaskTab(): void {
        try {
            void openTab({
                app: this.app,
                custom: {
                    id: this.name + TAB_TYPE,
                    icon: "iconTaskFlow",
                    title: "任务",
                },
            });
        } catch (e) {
            showMessage("任务流：Tab 打开失败 —— " + (e as Error).message, 5000, "error");
        }
    }

    /** 今天（yyyyMMdd） */
    private today(): string {
        return toDateStr(new Date());
    }

    /** 视图层的宿主实现：取数 / 写数都在这一层，组件不碰思源 API */
    private buildViewHost(): ViewHost {
        return {
            today: () => toDateStr(new Date()),

            load: async (view: ViewId, today: string) => {
                // 分发在 views/query.sqlForView 里（纯函数、已测）——
                // 每个视图都必须有归宿，漏一个就是真机上的「未知的智能清单」
                const [rows, notebooks] = await Promise.all([
                    runSql<TaskRow>(sqlForView(view, today)),
                    this.notebookMap(),
                ]);
                // 清单默认取笔记本名，所以映射时必须把表带进去
                return toViewTasks(rows, today, notebooks);
            },

            counts: async (today: string) => {
                const pairs = await Promise.all(smartListIds().map(async (id) => {
                    const rows = await runSql<{ c: number }>(countSql(id, { today }));
                    return [id, rows[0]?.c ?? 0] as const;
                }));
                return Object.fromEntries(pairs) as Record<SmartListId, number>;
            },

            loadRange: async (from: string, to: string) => {
                const [rows, notebooks] = await Promise.all([
                    runSql<TaskRow>(calendarSql(from, to)),
                    this.notebookMap(),
                ]);
                return toViewTasks(rows, this.today(), notebooks);
            },

            trends: async (today: string, days: number) => {
                const axis = recentDays(today, days);
                const from = axis[0] ?? today;
                const to = plusOneDay(axis[axis.length - 1] ?? today);
                const [created, done] = await Promise.all([
                    runSql<{ d: string; c: number }>(createdTrendSql(from, to)),
                    runSql<{ d: string; c: number }>(doneTrendSql(from, to)),
                ]);
                return { created: fillSeries(created, axis), done: fillSeries(done, axis) };
            },

            distributions: async () => {
                const [byList, byPriority] = await Promise.all([
                    runSql<{ name: string; c: number }>(listDistSql()),
                    runSql<{ p: string; c: number }>(priorityDistSql()),
                ]);
                return { byList, byPriority };
            },

            lists: async () => {
                const rows = await runSql<{ name: string }>(listsSql());
                return rows.map((r) => r.name).filter(Boolean);
            },

            // 标签：思源**内置**的 tags 属性，写进去思源会自动在 spans 里建索引
            setTags: async (id: string, tags: string[]) => {
                const v = tags.map((x) => x.trim()).filter(Boolean).join(",");
                await setAttrsAndWait(id, { tags: v }, "tags", v);
            },

            // ★ 任务 = 文档，文档没有复选框 → 完成状态就是 custom-done 时间戳
            toggleDone: (id: string) => this.toggleTaskDoneWithRepeat(id),

            openBlock: (id: string) => this.openBlock(id),

            openDetail: (id: string) => {
                // 视图里点中的那条 → 固定。
                // ⚠️ openDock() 是程序化 dockItem.click()，那次点击**不会**移动光标，
                //   所以不会再像以前那样把这里的固定清掉（见 ui/follow.ts）。
                this.pinnedTask = id;
                this.openDock();
                this.panel?.refresh();
            },

            setDue: async (id: string, due: string | null) => {
                const attrs = await getTaskAttrs(id);
                // 走 patchRange：它已经处理了「改日期时提醒跟着平移」这条语义
                const patch = patchRange(attrs, attrs[ATTR.start] ?? "", due ?? "");
                // 必须等写入**可见**再返回：否则紧接着的重载会读到旧值，
                // 界面看起来像"改了没生效"（真机实测约 1 秒延迟）
                await setAttrsAndWait(id, patch, ATTR.due, due ?? "");
            },

            setPriority: async (id: string, priority) => {
                await setAttrsAndWait(id, patchPriority(priority), ATTR.pri, patchPriority(priority)[ATTR.pri]);
            },

            setList: async (id: string, list: string) => {
                // 空串 = 移出清单（收件箱）。toAttrPatch 里空串即等于删除该属性。
                await setAttrsAndWait(id, patchList(list), ATTR.list, list);
            },

            // ★ 新建任务 = 新建文档（并打上任务标记）
            createTask: async (title: string, due: string | null) => {
                await this.createTaskDoc(title, due);
            },

            // ── 位置即关系：子任务 = 子文档 ──
            childTasks: (parentId: string) => childTasksOf(parentId),

            addSubTask: async (parentId: string, title: string) => {
                await createSubTask(parentId, title);
            },

            linkToParent: async (taskId: string, parentId: string) => {
                await linkTaskUnder(taskId, parentId);
            },

            detach: async (taskId: string) => {
                const rows = await runSql<{ box: string }>(
                    `select box from blocks where id='${taskId}' limit 1`,
                );
                const nb = rows[0]?.box;
                if (!nb) {
                    showMessage("任务流：找不到任务所在笔记本，无法解除", 4000, "error");
                    return;
                }
                await detachTask(taskId, nb);
            },

            renameTask: async (id: string, title: string) => {
                // 用文档重命名 API（改的是文件名，也就是 blocks.content = 任务标题）
                await callKernel("/api/filetree/renameDocByID", { id, title });
            },

            subscribe: (onChange: () => void) => {
                // 外部改动（编辑器里改了属性）也要让视图跟上，否则看板会是旧的
                const handler = (): void => { onChange(); };
                this.eventBus.on("ws-main", handler);
                return () => { this.eventBus.off("ws-main", handler); };
            },

            toast: (m: string) => showMessage(m, 3000),
        };
    }

    onunload(): void {
        if (this.remindTimer !== null) {
            window.clearInterval(this.remindTimer);
            this.remindTimer = null;
        }
        this.panel?.unmount();
        this.panel = null;
    }

    /**
     * 切换完成状态；**刚变成完成时**触发生成重复任务。
     *
     * 旧模型走的是「读 kramdown → 改 [ ]/[X] → 写回」；
     * 新模型（任务=文档）没有复选框，完成就是 custom-done 时间戳。
     */
    private async toggleTaskDoneWithRepeat(id: string): Promise<void> {
        const attrs = await getTaskAttrs(id);
        const wasDone = (attrs[ATTR.done] ?? "").trim() !== "";
        await this.toggleTaskDone(id);
        if (!wasDone) {
            await this.afterCompleted(id);
        }
    }

    /** 完成之后：如果有重复规则，生成下一个 */
    private async afterCompleted(id: string): Promise<void> {
        try {
            await generateNextRepeat(id, this.buildGenerateDeps());
        } catch (e) {
            // 生成失败不影响「完成任务」本身
            showMessage("任务流：" + ((e as Error)?.message ?? "重复生成失败"), 4000, "error");
        }
    }

    /**
     * 设置入口 —— 思源会在插件列表里显示一个齿轮，点它就调这里。
     * 用原生 Setting 类，和内置插件的设置长得一样。
     */
    openSetting(): void {
        void openSettingsDialog({
            load: () => loadSettings(),
            save: async (s) => {
                await saveSettings(s);
                this.settings = s;   // 立刻生效，不用重启
            },
            toast: (m: string) => showMessage(m, 3000),
        });
    }

    /** 读一次设置（前端启动时调） */
    private async loadSettingsOnce(): Promise<void> {
        this.settings = await loadSettings();
    }

    /**
     * 启动前端提醒扫描。每 60 秒一轮，和内核心跳同频。
     *
     * 首次运行会把游标设成当前时刻，**不补推历史** —— 否则一打开思源
     * 历史提醒会一次性全炸出来。
     */
    private startReminderScan(): void {
        const CURSOR_KEY = "task-flow-remind-cursor";
        const tick = async (): Promise<void> => {
            try {
                const r = await runReminderScan({
                    now: () => toDateTimeStr(new Date()),
                    readCursor: () => window.localStorage.getItem(CURSOR_KEY),
                    writeCursor: (c) => window.localStorage.setItem(CURSOR_KEY, c),
                    loadCandidates: async () => {
                        const rows = await runSql<{
                            id: string; title: string | null; remind: string | null;
                            due: string | null; pri: string | null; lst: string | null;
                        }>(remindCandidatesSql());
                        return rows.map((x) => ({
                            id: x.id, title: x.title, remind: x.remind,
                            due: x.due, pri: x.pri, lst: x.lst,
                        }));
                    },
                    toast: (m: string) => showMessage(m, 6000),
                    notifyDesktop: (t: string, b: string) => this.notifyDesktop(t, b),
                    wantsInApp: () => this.settings.inApp !== false,
                    wantsDesktop: () => this.settings.desktop !== false,
                });
                if (r.fired > 0) {
                    console.log(`[task-flow] 前端推了 ${r.fired} 条提醒，游标=${r.cursor}`);
                }
            } catch (e) {
                console.log("[task-flow] 提醒扫描出错: " + String((e as Error)?.message ?? e));
            }
        };
        void tick();
        this.remindTimer = window.setInterval(() => { void tick(); }, 60_000);
    }

    /**
     * 桌面通知。
     *
     * 权限要在**用户手势**里请求，这里只在已授权时发 —— 否则浏览器会静默丢弃，
     * 表现为"设置开了但没通知"，很难查。
     */
    private notifyDesktop(title: string, body: string): void {
        try {
            const N = (window as unknown as { Notification?: typeof Notification }).Notification;
            if (!N || N.permission !== "granted") {
                return;
            }
            new N(title, { body, tag: "task-flow-" + body.slice(0, 24) });
        } catch {
            /* 通知失败不影响其它通道 */
        }
    }

    /** 笔记本 id → 名字。文档任务的清单默认取它。 */
    private async notebookMap(): Promise<Record<string, string>> {
        try {
            const res = await callKernel<{ notebooks?: { id: string; name: string }[] }>(
                "/api/notebook/lsNotebooks", {},
            );
            return Object.fromEntries((res?.notebooks ?? []).map((n) => [n.id, n.name]));
        } catch {
            return {};
        }
    }

    /**
     * 切换完成状态。
     *
     * ★ 任务 = 文档，文档**没有复选框**，所以完成就是 `custom-done` 时间戳：
     *   写一个 yyyyMMddHHmm 表示完成，清空表示未完成。
     *   视图里的那个复选框是我们自己画的，它写的就是这个属性。
     */
    private async toggleTaskDone(id: string): Promise<void> {
        const attrs = await getTaskAttrs(id);
        const already = (attrs[ATTR.done] ?? "").trim();
        const next = already ? "" : toDateTimeStr(new Date());
        await setAttrsAndWait(id, { [ATTR.done]: next }, ATTR.done, next);
    }

    /**
     * 新建任务文档。
     *
     * 落在任务笔记本里，打上 custom-task 标记 —— 工作区有一千多个文档，
     * 不打标记的全都不算任务。
     */
    private async createTaskDoc(title: string, due: string | null): Promise<string | null> {
        const notebook = await ensureTaskNotebook();
        if (!notebook) {
            showMessage("任务流：找不到可用的笔记本，无法新建任务", 5000, "error");
            return null;
        }
        // markdown 里**不写 `# 标题`** —— 标题由路径给出，写了会变成正文里的第一个块
        const id = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, "");
        if (!id) {
            showMessage("任务流：新建任务文档失败", 5000, "error");
            return null;
        }
        const patch: Record<string, string> = { [ATTR.task]: "1" };
        if (due) {
            patch[ATTR.due] = due;
        }
        await setAttrsAndWait(id, patch, ATTR.task, "1");
        return id;
    }

    /** 前端提醒扫描的定时器 */
    private remindTimer: number | null = null;
    private settings: TaskFlowSettings = { ...DEFAULT_SETTINGS };

    /** 上一次观察到的光标块 id —— 用来判「光标是不是真的换了地方」 */
    private lastCaretBlockId: string | null = null;

    /** 待处理的一次性焦点请求（面板打开后由面板取走） */
    private pendingFocus: string | null = null;

    /** 重复生成的宿主 */
    private buildGenerateDeps(): GenerateDeps {
        return {
            now: () => new Date(),
            readAttrs: (id: string) => getTaskAttrs(id),
            readTitle: (id: string) => getTaskTitle(id),
            exportBody: async (id: string) => {
                const res = await callKernel<{ content?: string }>("/api/export/exportMdContent", { id });
                return res?.content ?? "";
            },
            notebookOf: async (id: string) => {
                const rows = await runSql<{ box: string }>(`select box from blocks where id='${id}' limit 1`);
                return rows[0]?.box ?? null;
            },
            createDoc: (notebook: string, title: string, markdown: string) =>
                createDocWithMd(notebook, `/${sanitizeTitle(title)}`, markdown),
            writeAttrs: (id: string, patch: Record<string, string>) => setAttrsAndWait(id, patch, ATTR.task, "1"),
        };
    }

    /** 块标菜单宿主 */
    private buildBlockMenuDeps(): BlockMenuDeps {
        return {
            now: () => new Date(),
            readAttrs: (id: string) => getTaskAttrs(id),
            writeAttrs: (id: string, patch: Record<string, string>) => setBlockAttrs(id, patch),
            openPanel: (id: string, focus?: string) => {
                // focus 之前被 `void id;` 一起丢掉了 —— 设计 T8 要求
                // 「面板打开且日期区获得焦点」，但实际从来没聚焦过
                this.pendingFocus = focus ?? "due";
                this.panel?.refresh();
                this.openDock();
                void id;
            },
            // ★ 任务 = 文档 → 老模型的 - [ ] 块不再是任务。
            //   「转为任务」= 把这个块升格成一个任务文档（建文档 → 搬内容 → 删原块）。
            promoteToTask: (id: string) => this.promoteBlockToTask(id),
            // 「不再作为任务」= 同类产品的「转为笔记」：去掉标记，内容全留着
            demoteFromTask: async (id: string) => {
                await setAttrsAndWait(id, { [ATTR.task]: "" }, ATTR.task, "");
                showMessage("已不再作为任务（内容都留着）", 3000);
            },
            onError: (m: string) => showMessage("任务流：" + m, 4000, "error"),
        };
    }

    /**
     * 把一个 `- [ ]` 块升格成任务文档。
     *
     * 顺序很关键：**先建文档，成功了再删原块** —— 反过来的话，
     * 建文档失败就丢内容了。
     */
    private async promoteBlockToTask(blockId: string): Promise<void> {
        const notebook = await ensureTaskNotebook();
        if (!notebook) {
            showMessage("任务流：找不到可用的笔记本", 4000, "error");
            return;
        }
        const kr = await getBlockKramdown(blockId);
        const { title, body } = splitTaskBlock(kr);
        if (!title) {
            showMessage("任务流：这个块没有标题，无法转为任务", 4000, "error");
            return;
        }
        const newId = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, body);
        if (!newId) {
            showMessage("任务流：建文档失败，原内容未改动", 4000, "error");
            return;
        }
        await setAttrsAndWait(newId, { [ATTR.task]: "1" }, ATTR.task, "1");
        // 文档建好了才删原块
        await deleteBlock(blockId);
        showMessage("已转为任务：" + title, 3000);
    }

    /** 面板宿主：全部通过 api 层，面板本身不碰思源 API */
    private buildPanelHost() {
        return {
            // 视图里点了卡片 → 固定到那条；否则跟光标走
            currentBlockId: async () => this.pinnedTask ?? await this.resolvedTaskBlockId(),
            readAttrs: (id: string) => getTaskAttrs(id),
            writeAttrs: (id: string, patch: Record<string, string>) => setBlockAttrs(id, patch),
            // 位置即关系：子任务 = 子文档
            childTasks: (id: string) => childTasksOf(id),
            addSubTask: async (id: string, title: string) => { await createSubTask(id, title); },
            linkToParent: async (id: string, parentId: string) => { await linkTaskUnder(id, parentId); },
            detach: async (id: string) => {
                const rows = await runSql<{ box: string }>(`select box from blocks where id='${id}' limit 1`);
                if (rows[0]?.box) await detachTask(id, rows[0].box);
            },
            renameTask: async (id: string, title: string) => {
                await callKernel("/api/filetree/renameDocByID", { id, title });
            },
            title: (id: string) => getTaskTitle(id),
            openBlock: (id: string) => this.openBlock(id),
            removeBlock: async (id: string) => { await deleteBlock(id); },
            takeFocus: () => {
                const f = this.pendingFocus;
                this.pendingFocus = null;
                return f;
            },
            loadRange: async (from: string, to: string) => {
                const [rows, notebooks] = await Promise.all([
                    runSql<TaskRow>(calendarSql(from, to)),
                    this.notebookMap(),
                ]);
                return toViewTasks(rows, this.today(), notebooks);
            },

            trends: async (today: string, days: number) => {
                const axis = recentDays(today, days);
                const from = axis[0] ?? today;
                const to = plusOneDay(axis[axis.length - 1] ?? today);
                const [created, done] = await Promise.all([
                    runSql<{ d: string; c: number }>(createdTrendSql(from, to)),
                    runSql<{ d: string; c: number }>(doneTrendSql(from, to)),
                ]);
                return { created: fillSeries(created, axis), done: fillSeries(done, axis) };
            },

            distributions: async () => {
                const [byList, byPriority] = await Promise.all([
                    runSql<{ name: string; c: number }>(listDistSql()),
                    runSql<{ p: string; c: number }>(priorityDistSql()),
                ]);
                return { byList, byPriority };
            },

            lists: async () => {
                const rows = await runSql<{ name: string }>(listsSql());
                return rows.map((r) => r.name).filter(Boolean);
            },

            // 标签：思源**内置**的 tags 属性，写进去思源会自动在 spans 里建索引
            setTags: async (id: string, tags: string[]) => {
                const v = tags.map((x) => x.trim()).filter(Boolean).join(",");
                await setAttrsAndWait(id, { tags: v }, "tags", v);
            },
            tagsOf: async (id: string) => {
                const rows = await runSql<{ t: string | null }>(
                    `select (select group_concat(s.content, ',') from spans s
                      where s.type='tag' and s.root_id=b.id) t from blocks b where b.id='${id}'`,
                );
                return (rows[0]?.t ?? "").split(",").map((x) => x.trim()).filter(Boolean);
            },

            // ★ 任务 = 文档，文档没有复选框 → 完成状态就是 custom-done 时间戳
            toggleDone: (id: string) => this.toggleTaskDoneWithRepeat(id),
            // 任务=文档：完成状态是 custom-done，不再是 [X]
            isDone: async (id: string) => ((await getTaskAttrs(id))[ATTR.done] ?? "") !== "",
            toast: (m: string) => showMessage(m, 3000),
            now: () => new Date(),
        };
    }

    private buildDeps(): TaskCommandDeps {
        return {
            now: () => new Date(),
            activeTaskBlockId: () => this.resolvedTaskBlockId(),
            selectedBlockCount: () => countSelectedBlocks(),
            readAttrs: (id) => getTaskAttrs(id),
            writeAttrs: (id, patch) => {
                if (!this.transportReady) {
                    return Promise.reject(new Error(NOT_READY));
                }
                return setBlockAttrs(id, patch);
            },
            readKramdown: (id) => getBlockKramdown(id),
            writeKramdown: (id, md) => updateBlockMarkdown(id, md),
            openTaskTab: () => this.openTaskTab(),
            openSettings: () => this.openSetting(),
            togglePin: async (id: string, attrs: Record<string, string>) => {
                const pinned = (attrs[ATTR.pin] ?? "").trim() !== "";
                const next = pinned ? "" : "1";
                await setAttrsAndWait(id, { [ATTR.pin]: next }, ATTR.pin, next);
                showMessage(next ? "已置顶" : "已取消置顶", 2000);
            },
            // ⌥⇧D 走的是这一条（块标菜单走 buildBlockMenuDeps 的那条）。
            // 这里曾经写成 `openPanel: () => {…}`，连参数都不收 ——
            // 所以命令层传下来的 focus 在插件这一层就被丢了，面板永远不聚焦。
            openPanel: (_id: string, focus?: string) => {
                this.pendingFocus = focus ?? "due";
                this.panel?.refresh();
                this.openDock();
            },
            onCompleted: (id: string) => this.afterCompleted(id),
            toast: (m) => showMessage(m, 3000),
        };
    }

    /** 光标块 → 归一化到任务项（面板与命令层必须用同一套口径） */
    private async resolvedTaskBlockId(): Promise<string | null> {
        const cur = this.currentBlockId();
        return cur ? await resolveTaskBlock(cur) : null;
    }

    /** 当前编辑器里光标所在的块 id（未归一化） */
    /** 跳到某个块：用思源的 URL 协议打开所在文档并定位（3.8.4 里没有 openBlock 全局，这是可用路径） */
    private openBlock(id: string): void {
        const w = window as unknown as { openFileByURL?: (u: string) => void };
        if (typeof w.openFileByURL === "function") {
            w.openFileByURL(`siyuan://blocks/${id}`);
            return;
        }
        showMessage("任务流：当前前端不支持跳转", 3000, "error");
    }

    private currentBlockId(): string | null {
        try {
            return cursorBlockId(getActiveEditor(true) as unknown as ProtyleLike);
        } catch {
            return null;
        }
    }

    /** 把右侧栏的「任务信息」面板展开出来 */
    private openDock(): void {
        try {
            const item = document.querySelector<HTMLElement>(`[data-type="${this.name}${DOCK_TYPE}"]`);
            item?.click();
        } catch {
            /* 面板没挂上就算了，不影响命令本身 */
        }
    }
}

