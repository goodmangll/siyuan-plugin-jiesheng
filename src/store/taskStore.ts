/**
 * 任务数据的**唯一来源**（前端侧）。
 *
 * ## 为什么要有这一层
 *
 * 原来「快照 + 本地未落定的改动 + 派生 + 写入生命周期」这套东西是散在
 * `TabApp` 里的：11 个 `useState` / `useRef`（base、pending、代次号、落定集合、
 * 计数基线…）和渲染搅在一起，而 Board / Calendar / Matrix 干脆没有乐观更新 ——
 * 每次拖拽都要等思源那约 2.5 秒的索引延迟。
 *
 * 于是每加一个视图内的可写操作，就得在某处再补一段几乎一样的逻辑。
 *
 * 抽到这里之后只有一条规则：
 *
 * ```
 *   渲染 = 派生(base 快照, pending 改动)
 * ```
 *
 * 写入一律走 `mutate()`：先按本地算好的结果生效 → 再去写库 →
 * 落定后刷新一次快照、撤掉那次 pending。
 *
 * ## 两条不能破的约束（都是真机踩出来的）
 *
 * 1. **读操作不等写入落定。** 思源的属性写入对 SQL 有约 2.5 秒的可见延迟
 *    （实测 2495~2687ms），等它会让每次读白等 0.8 秒。所以读保持快、
 *    pending 负责兜住这段时间。
 * 2. **pending 只能在「这次写入自己落定」后撤。** 点击之前就发起的那次刷新
 *    会带着旧快照回来，撤了 pending 就等于把乐观结果还回去 —— 界面整个回退。
 *    所以用 `settled` 集合区分「谁落定了」，而不是「有一次刷新回来了」。
 */

import { smartListsOf, type SmartListId } from "../views/query";
import type { ViewId } from "../views/host";
import type { ViewTask } from "../views/model";

export interface TaskStoreDeps {
    /** 拉某个视图的行 */
    load(view: ViewId, today: string): Promise<ViewTask[]>;
    /** 拉侧栏数字 */
    counts(today: string): Promise<Record<SmartListId, number>>;
    /** 今天，`yyyyMMdd` */
    today: string;
    /** 当前时刻，`yyyyMMddHHmm` —— 本地先算完成时刻用 */
    now(): string;
    /**
     * 一次改动写库失败。
     *
     * 由调用方决定怎么告诉用户（弹提示）—— store 不管消息，
     * 否则「视图加载失败」和「这次写入失败」会混在同一个 error 槽里，
     * 一刷新就互相盖掉（写失败的真机现象：错误一闪而过、看不见）。
     */
    onMutateError(e: Error): void;
}

/** 一条尚未落定的本地改动 */
export interface PendingChange {
    /** 改动前（用于把侧栏数字的差额算回去） */
    before: ViewTask | null;
    /** 改动后；`null` = 这条应当从所有列表里消失（删除） */
    after: ViewTask | null;
}

export interface TaskStore {
    subscribe(fn: () => void): () => void;
    /**
     * 版本号，每次变化 +1。
     *
     * 给 `useSyncExternalStore` 用的：它要一个**稳定可比**的快照值，
     * 直接返回 `items()`（每次都新建数组）会导致无限重渲染。
     */
    version(): number;
    getView(): ViewId;
    setView(v: ViewId): void;
    /** 当前视图要渲染的行（已叠加未落定的改动） */
    items(): ViewTask[];
    /** 侧栏数字（已叠加未落定的改动） */
    counts(): Record<SmartListId, number>;
    status(): StoreStatus;
    /** 拉一次快照 */
    refresh(): Promise<void>;
    /**
     * 一次本地改动。
     *
     * `after` 由调用方按「本地算好的结果」给出 —— 它同时决定了界面立刻变成什么
     * 和这次改动影响哪些清单。`null` 表示这条应当消失（删除）。
     */
    mutate(id: string, after: ViewTask | null, run: () => Promise<unknown>): Promise<void>;
    /** 外部（内核推送）说数据变了 —— 防抖后刷新 */
    pokeKernelChange(): void;
}

export interface StoreStatus {
    state: "loading" | "ready" | "error";
    error: string;
}

const EMPTY_COUNTS: Record<SmartListId, number> = {
    today: 0, tomorrow: 0, next7: 0, inbox: 0, all: 0, done: 0,
};

/**
 * 这条任务现在该不该出现在这个视图里。
 *
 * 智能清单各有日期/完成归属（见 `smartListsOf`）；
 * 「看板」「四象限」都只放未完成；日历与统计不在这里过滤
 * （它们的数据来自别的 SQL，见 README 里的说明）。
 */
export function belongsTo(task: ViewTask, view: ViewId, today: string): boolean {
    if (view === "board" || view === "matrix") {
        return task.done === null;
    }
    if (view === "calendar" || view === "stats") {
        return true;
    }
    return smartListsOf(task, today).includes(view);
}

/**
 * 派生要渲染的行：**pending 优先于 base**。
 *
 * - base 里有、pending 也有的 → 用 pending 的版本；若 pending 说它不再属于
 *   这个视图，就不出现（比如刚完成的任务从「今天」消失）
 * - base 里没有、pending 有的 → 补进来，**排在最前**
 *   （刚完成的在「已完成」里本来就该最新；`order by done desc`）
 */
export function deriveTasks(
    base: ViewTask[],
    pending: Map<string, PendingChange>,
    view: ViewId,
    today: string,
): ViewTask[] {
    if (pending.size === 0) {
        return base;
    }
    const out: ViewTask[] = [];
    for (const r of base) {
        if (pending.has(r.id)) {
            continue; // 交给下面按 pending 处理
        }
        out.push(r);
    }
    const add: ViewTask[] = [];
    for (const [id, p] of pending) {
        if (!p.after) {
            continue; // 删除
        }
        if (!belongsTo(p.after, view, today)) {
            continue;
        }
        const at = out.findIndex((t) => t.id === id);
        if (at >= 0) {
            out[at] = p.after; // 原地替换，保持排序位置
        } else {
            add.push(p.after);
        }
    }
    return add.length ? [...add, ...out] : out;
}

/** 把 pending 造成的差额算到侧栏数字上（数字来自 SQL，可能还没追上） */
export function deriveCounts(
    base: Record<SmartListId, number>,
    pending: Map<string, PendingChange>,
    today: string,
): Record<SmartListId, number> {
    if (pending.size === 0) {
        return base;
    }
    const next = { ...base };
    const bump = (t: ViewTask | null, sign: number): void => {
        if (!t) {
            return;
        }
        for (const id of smartListsOf(t, today)) {
            next[id] = Math.max(0, next[id] + sign);
        }
    };
    for (const p of pending.values()) {
        bump(p.before, -1);
        bump(p.after, +1);
    }
    return next;
}

export function createTaskStore(deps: TaskStoreDeps): TaskStore {
    let view: ViewId = "today";
    let base: ViewTask[] = [];
    let baseCounts: Record<SmartListId, number> = { ...EMPTY_COUNTS };
    let status: StoreStatus = { state: "loading", error: "" };

    const pending = new Map<string, PendingChange>();
    /** 已经落定、可以撤掉 pending 的 id */
    const settled = new Set<string>();
    /** 代次号：只有最新一次刷新的结果允许落地 */
    let gen = 0;
    let kernelTimer: ReturnType<typeof setTimeout> | null = null;
    const listeners = new Set<() => void>();
    let version = 0;

    const notify = (): void => {
        version += 1;
        for (const fn of [...listeners]) {
            fn();
        }
    };

    const refresh = async (): Promise<void> => {
        const mine = ++gen;
        try {
            const [rows, c] = await Promise.all([
                deps.load(view, deps.today),
                deps.counts(deps.today),
            ]);
            if (mine !== gen) {
                return; // 已经有更新的一次刷新了，这份作废
            }
            base = rows;
            baseCounts = c;
            // ★ 先撤「已落定」的 pending，再通知 ——
            //   顺序反了会把同一笔差额算两遍（真机：已完成闪一下 2）
            for (const id of settled) {
                pending.delete(id);
            }
            settled.clear();
            status = { state: "ready", error: "" };
        } catch (e) {
            if (mine !== gen) {
                return;
            }
            status = { state: "error", error: (e as Error)?.message ?? String(e) };
        }
        notify();
    };

    return {
        subscribe(fn) {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },

        version: () => version,

        getView: () => view,

        setView(v) {
            if (v === view) {
                return;
            }
            view = v;
            notify(); // 先让导航高亮切过去，数据随后到
            void refresh();
        },

        items: () => deriveTasks(base, pending, view, deps.today),
        counts: () => deriveCounts(baseCounts, pending, deps.today),
        status: () => status,

        refresh,

        async mutate(id, after, run) {
            const known = deriveTasks(base, pending, view, deps.today).find((t) => t.id === id)
                ?? pending.get(id)?.after
                ?? null;
            pending.set(id, { before: pending.get(id)?.before ?? known, after });
            notify(); // 界面立刻生效
            try {
                await run();
            } catch (e) {
                // 写失败：撤掉这次乐观改动，回到 SQL 的真值，并告诉调用方
                pending.delete(id);
                notify();
                await refresh();
                deps.onMutateError(e as Error);
                return;
            }
            settled.add(id);
            await refresh();
        },

        pokeKernelChange() {
            if (kernelTimer !== null) {
                return; // 合并同一批改动
            }
            kernelTimer = setTimeout(() => {
                kernelTimer = null;
                void refresh();
            }, 150);
        },
    };
}
