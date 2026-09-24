/**
 * 思源插件入口。
 *
 * 这一层只做「接线」：把 commands / api / ui 三块拼到思源的 Plugin 生命周期上。
 * 所有可测的逻辑都在下层，这里不做判断。
 */
import { Plugin, fetchSyncPost, getActiveEditor, openTab, showMessage } from "siyuan";
import {
    deleteBlock, getBlockKramdown, getTaskAttrs, getTaskTitle, insertBlockAfter,
    resolveTaskBlock, setBlockAttrs, setTransport, updateBlockMarkdown,
} from "./api/blocks";
import { countSelectedBlocks } from "./api/dom";
import {
    childTasksOf, createSubTask, detachTask, ensureTaskNotebook, linkTaskUnder, sanitizeTitle,
    setAttrsAndWait,
} from "./api/views";
import { callKernel, createDocWithMd, runSql } from "./api/blocks";
import { mountTab, type TabHandle } from "./views/mountTab";
import { calendarSql, countSql, listsSql, smartListIds, sqlForView, type SmartListId } from "./views/query";
import {
    createdTrendSql, doneTrendSql, fillSeries, listDistSql, priorityDistSql, recentDays,
} from "./views/stats";
import { toViewTasks, type TaskRow } from "./views/model";
import type { ViewHost, ViewId } from "./views/host";
import { patchList, patchPriority, patchRange } from "./ui/panelActions";
import { toDateStr } from "./model/date";
import { ATTR } from "./model/attrs";
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

        // 光标在编辑器里移动时，面板跟着换任务
        this.eventBus.on("click-editorcontent", () => {
            this.panel?.refresh();
        });

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

        // 在编辑器里点一下就解除卡片固定，否则面板会一直停在上次点的那条
        document.addEventListener("click", (e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.(".tf-tab-root")) {
                return;
            }
            this.pinnedTask = null;
        }, true);
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

            // ★ 任务 = 文档，文档没有复选框 → 完成状态就是 custom-done 时间戳
            toggleDone: (id: string) => this.toggleTaskDoneWithRepeat(id),

            openBlock: (id: string) => this.openBlock(id),

            openDetail: (id: string) => {
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

    /** 重复生成的宿主 */
    private buildGenerateDeps(): GenerateDeps {
        return {
            now: () => new Date(),
            readAttrs: (id: string) => getTaskAttrs(id),
            readTitle: (id: string) => getTaskTitle(id),
            insertAfter: (prev: string, md: string) => insertBlockAfter(prev, md),
            writeAttrs: (id: string, patch: Record<string, string>) => setBlockAttrs(id, patch),
            toast: (m: string) => showMessage(m, 3500),
        };
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
     * 落在「任务流收件箱」笔记本里（没有就建一个），打上 custom-task 标记，
     * 这样才会被视图捞出来（文档数以千计，不打标记的全都不算任务）。
     */
    private async createTaskDoc(title: string, due: string | null): Promise<string | null> {
        const notebook = await ensureTaskNotebook();
        if (!notebook) {
            showMessage("任务流：找不到可用的笔记本，无法新建任务", 5000, "error");
            return null;
        }
        const id = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, `# ${title}\n\n`);
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

    /** 待处理的一次性焦点请求（面板打开后由面板取走） */
    private pendingFocus: string | null = null;

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
            onError: (m: string) => showMessage("任务流：" + m, 4000, "error"),
        };
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

