/**
 * 宿主适配器 —— 「视图/面板/命令/菜单」与思源之间的**唯一**接触面。
 *
 * 组件与命令层不直接碰思源 API，全部经这些 host 拿。好处是 React 可以脱离思源
 * 单测（`tests/ui/*.test.tsx` 就是这么跑的），而且「怎么取数、写到哪」的判断
 * 集中在这里，不散在 JSX 里。
 *
 * 这些适配器原来长在 `Plugin` 子类的 `this` 上，占到那个文件的一半。
 * 抽出来之后每个 builder 只声明自己需要什么（`HostDeps`），
 * 「谁依赖了什么」一眼可见，也不必为了测一段逻辑去构造整个插件。
 */

import {
    callKernel, deleteBlock, getBlockKramdown, getTaskAttrs, getTaskTitle, runSql, updateBlockMarkdown,
} from "../api/blocks";
import { countSelectedBlocks } from "../api/dom";
import { setAttrsAndWait } from "../api/views";
import {
    childTasksOf, createSubTask, detachTask, linkTaskUnder,
} from "../api/views";
import { ATTR } from "../model/attrs";
import { toDateStr, toDateTimeStr } from "../model/date";
import { patchList, patchPriority, patchRange } from "../ui/panelActions";
import type { BlockMenuDeps } from "../ui/blockMenu";
import type { TaskCommandDeps } from "../commands";
import type { ViewHost, ViewId } from "../views/host";
import { calendarSql, countsSql, listsSql, smartListIds, sqlForView, type SmartListId } from "../views/query";
import {
    createdTrendSql, doneTrendSql, fillSeries, listDistSql, priorityDistSql, recentDays,
} from "../views/stats";
import { toViewTasks, type TaskRow } from "../views/model";
import { isTaskDataChange } from "../views/txFilter";
import type { EditorSession } from "./session";

/** 所有 host 共用的依赖 —— 显式声明，不再靠 `this` 兜着 */
export interface HostDeps {
    /** 编辑器会话：面板跟谁走、跳到哪、开面板/标签 */
    session: EditorSession;
    /** 笔记本 id → 名字（带缓存） */
    notebookMap(): Promise<Record<string, string>>;
    /** 今天 `yyyyMMdd` */
    todayStr(): string;
    /** 内核事件总线（订阅 `ws-main` 用） */
    eventBus: { on(type: string, fn: (e: CustomEvent) => void): void; off(type: string, fn: (e: CustomEvent) => void): void };
    /** 跳到某个块 */
    openBlock(id: string): void;
    /** 打开设置 */
    openSettings(): void;
    /** 任务写操作 */
    toggleDone(id: string): Promise<void>;
    afterCompleted(id: string): Promise<void>;
    createTask(title: string, due: string | null): Promise<string | null>;
    promoteToTask(id: string): Promise<void>;
    /** transport 是否就绪（未就绪时命令层要明确报错，不能静默失败） */
    transportReady(): boolean;
    toast(message: string, ms?: number): void;
    errorToast(message: string): void;
}

const NOT_READY = "任务流：插件仍在初始化，请稍后再试";

/** 视图层（Tab）的宿主 */
export function buildViewHost(deps: HostDeps): ViewHost {
    return {
        today: () => deps.todayStr(),
        nowStamp: () => toDateTimeStr(new Date()),

        load: async (view: ViewId, today: string) => {
            // 分发在 views/query.sqlForView 里（纯函数、已测）——
            // 每个视图都必须有归宿，漏一个就是真机上的「未知的智能清单」
            const [rows, notebooks] = await Promise.all([
                runSql<TaskRow>(sqlForView(view, today)),
                deps.notebookMap(),
            ]);
            // 清单默认取笔记本名，所以映射时必须把表带进去
            return toViewTasks(rows, today, notebooks);
        },

        counts: async (today: string) => {
            // ★ 一条 SQL 拿 6 个数字。原来是 6 次并发的 IPC ——
            //   一次重载因此要 8 个来回（1 列表 + 1 笔记本表 + 6 计数）。
            const rows = await runSql<Record<string, number>>(countsSql({ today }));
            const r = rows[0] ?? {};
            const out = {} as Record<SmartListId, number>;
            for (const id of smartListIds()) {
                out[id] = Number(r[id] ?? 0);
            }
            return out;
        },

        loadRange: async (from: string, to: string) => {
            const [rows, notebooks] = await Promise.all([
                runSql<TaskRow>(calendarSql(from, to)),
                deps.notebookMap(),
            ]);
            return toViewTasks(rows, deps.todayStr(), notebooks);
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
        toggleDone: (id: string) => deps.toggleDone(id),

        openBlock: (id: string) => deps.openBlock(id),

        openDetail: (id: string) => {
            // 视图里点中的那条 → 固定。
            // ⚠️ openDock() 是程序化 dockItem.click()，那次点击**不会**移动光标，
            //   所以不会再像以前那样把这里的固定清掉（见 ui/follow.ts）。
            deps.session.pin(id);
            deps.session.openPanel();
        },

        setDue: async (id: string, due: string | null) => {
            const attrs = await getTaskAttrs(id);
            // 走 patchRange：它已经处理了「改日期时提醒跟着平移」这条语义
            const patch = patchRange(attrs, attrs[ATTR.start] ?? "", due ?? "");
            // 必须等写入**可见**再返回：否则紧接着的重载会读到旧值，
            // 界面看起来像「改了没生效」
            await setAttrsAndWait(id, patch, ATTR.due, due ?? "");
        },

        setPriority: async (id: string, priority) => {
            const patch = patchPriority(priority);
            await setAttrsAndWait(id, patch, ATTR.pri, patch[ATTR.pri]);
        },

        setList: async (id: string, list: string) => {
            // 空串 = 移出清单（收件箱）。空串即等于删除该属性。
            await setAttrsAndWait(id, patchList(list), ATTR.list, list);
        },

        // ★ 新建任务 = 新建文档（并打上任务标记）
        createTask: async (title: string, due: string | null) => {
            await deps.createTask(title, due);
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
            const nb = await notebookOf(taskId);
            if (!nb) {
                deps.errorToast("任务流：找不到任务所在笔记本，无法解除");
                return;
            }
            await detachTask(taskId, nb);
        },

        renameTask: async (id: string, title: string) => {
            // 用文档重命名 API（改的是文件名，也就是 blocks.content = 任务标题）
            await callKernel("/api/filetree/renameDocByID", { id, title });
        },

        subscribe: (onChange: () => void) => subscribeTaskChanges(deps, onChange),

        toast: (m: string) => deps.toast(m, 3000),
    };
}

/** 面板（Dock）的宿主 */
export function buildPanelHost(deps: HostDeps) {
    return {
        // 视图里点了卡片 → 固定到那条；否则跟光标走
        currentBlockId: async () => deps.session.currentBlockId(),
        readAttrs: (id: string) => getTaskAttrs(id),
        writeAttrs: (id: string, patch: Record<string, string>) => setAttrsAndWait(id, patch),
        // 位置即关系：子任务 = 子文档
        childTasks: (id: string) => childTasksOf(id),
        addSubTask: async (id: string, title: string) => { await createSubTask(id, title); },
        linkToParent: async (id: string, parentId: string) => { await linkTaskUnder(id, parentId); },
        detach: async (id: string) => {
            const nb = await notebookOf(id);
            if (nb) {
                await detachTask(id, nb);
            }
        },
        renameTask: async (id: string, title: string) => {
            await callKernel("/api/filetree/renameDocByID", { id, title });
        },
        title: (id: string) => getTaskTitle(id),
        openBlock: (id: string) => deps.openBlock(id),
        removeBlock: async (id: string) => { await deleteBlock(id); },
        takeFocus: () => deps.session.takeFocus(),
        lists: async () => {
            const rows = await runSql<{ name: string }>(listsSql());
            return rows.map((r) => r.name).filter(Boolean);
        },
        tagsOf: async (id: string) => {
            const rows = await runSql<{ t: string | null }>(
                `select (select group_concat(s.content, ',') from spans s
                  where s.type='tag' and s.root_id=b.id) t from blocks b where b.id='${id}'`,
            );
            return (rows[0]?.t ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        },
        setTags: async (id: string, tags: string[]) => {
            const v = tags.map((x) => x.trim()).filter(Boolean).join(",");
            await setAttrsAndWait(id, { tags: v }, "tags", v);
        },
        toggleDone: (id: string) => deps.toggleDone(id),
        isDone: async (id: string) => ((await getTaskAttrs(id))[ATTR.done] ?? "") !== "",
        toast: (m: string) => deps.toast(m, 3000),
        now: () => new Date(),
        loadRange: async (from: string, to: string) => {
            const [rows, notebooks] = await Promise.all([
                runSql<TaskRow>(calendarSql(from, to)),
                deps.notebookMap(),
            ]);
            return toViewTasks(rows, deps.todayStr(), notebooks);
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
    };
}

/** 命令层的依赖（10 个快捷键 ⌥⇧* 走它） */
export function buildCommandDeps(deps: HostDeps): TaskCommandDeps {
    return {
        now: () => new Date(),
        activeTaskBlockId: () => deps.session.currentBlockId(),
        selectedBlockCount: () => countSelectedBlocks(),
        readAttrs: (id) => getTaskAttrs(id),
        writeAttrs: (id, patch) => {
            if (!deps.transportReady()) {
                return Promise.reject(new Error(NOT_READY));
            }
            return setAttrsAndWait(id, patch);
        },
        readKramdown: (id) => getBlockKramdown(id),
        writeKramdown: (id, md) => updateBlockMarkdown(id, md),
        openTaskTab: () => deps.session.openTab(),
        openSettings: () => deps.openSettings(),
        togglePin: async (id: string, attrs: Record<string, string>) => {
            const pinned = (attrs[ATTR.pin] ?? "").trim() !== "";
            const next = pinned ? "" : "1";
            await setAttrsAndWait(id, { [ATTR.pin]: next }, ATTR.pin, next);
            deps.toast(next ? "已置顶" : "已取消置顶", 2000);
        },
        // ⌥⇧D 走的是这一条（块标菜单走 buildBlockMenuDeps 的那条）。
        // 这里曾经写成 `openPanel: () => {…}`，连参数都不收 ——
        // 所以命令层传下来的 focus 在插件这一层就被丢了，面板永远不聚焦。
        openPanel: (_id: string, focus?: string) => deps.session.openPanel(focus),
        onCompleted: (id: string) => deps.afterCompleted(id),
        toast: (m) => deps.toast(m, 3000),
    };
}

/** 块标菜单的宿主 */
export function buildBlockMenuDeps(deps: HostDeps): BlockMenuDeps {
    return {
        now: () => new Date(),
        readAttrs: (id: string) => getTaskAttrs(id),
        writeAttrs: (id: string, patch: Record<string, string>) => setAttrsAndWait(id, patch),
        openPanel: (_id: string, focus?: string) => deps.session.openPanel(focus),
        // ★ 任务 = 文档 → 老模型的 - [ ] 块不再是任务。
        //   「转为任务」= 把这个块升格成一个任务文档（建文档 → 搬内容 → 删原块）。
        promoteToTask: (id: string) => deps.promoteToTask(id),
        // 「不再作为任务」= 同类产品的「转为笔记」：去掉标记，内容全留着
        demoteFromTask: async (id: string) => {
            await setAttrsAndWait(id, { [ATTR.task]: "" }, ATTR.task, "");
            deps.toast("已不再作为任务（内容都留着）", 3000);
        },
        onError: (m: string) => deps.errorToast("任务流：" + m),
    };
}

/**
 * 订阅「任务数据真的变了」。
 *
 * ⚠️ **不能**收到 `ws-main` 就刷新：那是内核所有推送的总线，
 * 插件重载、后台任务进度、同步状态都会走它。真机静置 10 秒，
 * 什么都没做也重载了 7 次（每次 8 个 IPC）。只认 `views/txFilter` 判定的信号 + 防抖。
 */
function subscribeTaskChanges(deps: HostDeps, onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (event: CustomEvent): void => {
        if (!isTaskDataChange(event?.detail)) {
            return;
        }
        if (timer !== null) {
            return; // 合并同一批改动
        }
        timer = setTimeout(() => {
            timer = null;
            onChange();
        }, 150);
    };
    deps.eventBus.on("ws-main", handler);
    return () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        deps.eventBus.off("ws-main", handler);
    };
}

function plusOneDay(day: string): string {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(4, 6));
    const d = Number(day.slice(6, 8));
    const t = new Date(y, m - 1, d + 1);
    return toDateStr(t);
}

async function notebookOf(id: string): Promise<string | null> {
    const rows = await runSql<{ box: string }>(`select box from blocks where id='${id}' limit 1`);
    return rows[0]?.box ?? null;
}

