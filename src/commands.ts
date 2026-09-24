/**
 * 命令层：把「快捷键」翻译成「对任务块的属性写入」。
 *
 * 这一层**不碰任何 UI 与思源 API**，全部依赖注入，因此可以完整单测。
 * 快捷键空间的选择依据见《M0 验证报告》§3：`Alt+Shift+*` 实测 104 个组合空闲，
 * 而同类产品原本的 `Tab+*` / `Alt+数字` 在思源里分别「不触发」和「被内置占用」。
 */

import { ATTR } from "./model/attrs";
import { isAllDay, nextWeekSameDay, toDateStr } from "./model/date";
import { priorityAttr, type Priority } from "./model/priority";
import { isDone, isTaskKramdown, setTaskDone } from "./model/task";

export interface TaskCommandDeps {
    /** 当前时间（注入以便测试） */
    now(): Date;
    /** 取当前该操作的任务块 id；光标不在任务块上时返回 null */
    activeTaskBlockId(): Promise<string | null>;
    /** 读属性（调用方负责双宿主合并） */
    readAttrs(id: string): Promise<Record<string, string>>;
    /** 写属性补丁；空串表示删除 */
    writeAttrs(id: string, patch: Record<string, string>): Promise<void>;
    /** 读块 kramdown */
    readKramdown(id: string): Promise<string>;
    /** 写回块 kramdown */
    writeKramdown(id: string, markdown: string): Promise<void>;
    /** 打开任务面板（M2 实现） */
    openPanel(id: string, focus?: string): void;
    /** 轻提示 */
    toast?(message: string): void;
}

export interface TaskCommand {
    /** i18n key，同时用于区分快捷键 */
    langKey: string;
    /** 中文文案（面板与快捷键设置里显示） */
    langText: string;
    /** 默认快捷键，`⌥⇧x` 形式 */
    hotkeys: string[];
    run(deps: TaskCommandDeps): Promise<void>;
}

// ── 公共前置：拿到任务块并读属性 ──────────────────────────────────────────────

/** 取当前任务块 id；拿不到时给提示并返回 null（不抛异常） */
export async function currentTaskBlockId(deps: TaskCommandDeps): Promise<string | null> {
    try {
        const id = await deps.activeTaskBlockId();
        if (!id) {
            deps.toast?.("任务流：请把光标放在一个任务上");
            return null;
        }
        return id;
    } catch {
        deps.toast?.("任务流：无法确定当前任务");
        return null;
    }
}

async function withTask(
    deps: TaskCommandDeps,
    fn: (id: string, attrs: Record<string, string>) => Promise<void>,
): Promise<void> {
    const id = await currentTaskBlockId(deps);
    if (!id) {
        return;
    }
    let attrs: Record<string, string> = {};
    try {
        attrs = await deps.readAttrs(id);
    } catch {
        attrs = {};
    }
    await fn(id, attrs);
}

// ── 动作 ─────────────────────────────────────────────────────────────────────

export async function setPriority(deps: TaskCommandDeps, level: Priority): Promise<void> {
    await withTask(deps, async (id) => {
        const value = priorityAttr(level);
        await deps.writeAttrs(id, { [ATTR.pri]: value ?? "" });
    });
}

export type DueKind = "today" | "tomorrow" | "nextWeek";

function addOne(d: Date): Date {
    const r = new Date(d.getTime());
    r.setDate(r.getDate() + 1);
    return r;
}

/**
 * 设为今天 / 明天 / 下周 —— **保留原有的时刻形态**：
 * 原本是全天就仍是全天，原本有时刻就换日期不换时刻。
 */
export async function setDueTo(deps: TaskCommandDeps, kind: DueKind): Promise<void> {
    await withTask(deps, async (id, attrs) => {
        const old = attrs[ATTR.due];
        const anchor = deps.now();
        const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        const target = kind === "today" ? base : kind === "tomorrow" ? addOne(base) : nextWeekSameDay(base);
        const value = !old || isAllDay(old) ? toDateStr(target) : toDateStr(target) + old.slice(8, 12);
        await deps.writeAttrs(id, { [ATTR.due]: value });
    });
}

/** 清除日期：只动 custom-due */
export async function clearDue(deps: TaskCommandDeps): Promise<void> {
    await withTask(deps, async (id) => {
        await deps.writeAttrs(id, { [ATTR.due]: "" });
    });
}

/** 完成 / 取消完成：只改 kramdown 首行的标记，子块字节级不动 */
export async function toggleDone(deps: TaskCommandDeps): Promise<void> {
    const id = await currentTaskBlockId(deps);
    if (!id) {
        return;
    }
    const kr = await deps.readKramdown(id);
    if (!isTaskKramdown(kr)) {
        deps.toast?.("任务流：当前块不是任务");
        return;
    }
    const next = setTaskDone(kr, !isDone(kr));
    if (next === null) {
        deps.toast?.("任务流：无法切换完成状态");
        return;
    }
    await deps.writeKramdown(id, next);
}

/** 打开任务面板 */
export async function openPanel(deps: TaskCommandDeps): Promise<void> {
    const id = await currentTaskBlockId(deps);
    if (!id) {
        return;
    }
    deps.openPanel(id);
}

// ── 命令表 ───────────────────────────────────────────────────────────────────

const HK = {
    p1: "\u2325\u21e71", p2: "\u2325\u21e72", p3: "\u2325\u21e73", p0: "\u2325\u21e70",
    today: "\u2325\u21e7Q", tomorrow: "\u2325\u21e7W", nextWeek: "\u2325\u21e7E", clearDue: "\u2325\u21e7X",
    panel: "\u2325\u21e7D", done: "\u2325\u21e7M",
} as const;

export const COMMANDS: TaskCommand[] = [
    { langKey: "priorityHigh", langText: "任务：优先级 高", hotkeys: [HK.p1], run: (d) => setPriority(d, "high") },
    { langKey: "priorityMedium", langText: "任务：优先级 中", hotkeys: [HK.p2], run: (d) => setPriority(d, "medium") },
    { langKey: "priorityLow", langText: "任务：优先级 低", hotkeys: [HK.p3], run: (d) => setPriority(d, "low") },
    { langKey: "priorityNone", langText: "任务：清除优先级", hotkeys: [HK.p0], run: (d) => setPriority(d, "none") },
    { langKey: "dueToday", langText: "任务：设为今天", hotkeys: [HK.today], run: (d) => setDueTo(d, "today") },
    { langKey: "dueTomorrow", langText: "任务：设为明天", hotkeys: [HK.tomorrow], run: (d) => setDueTo(d, "tomorrow") },
    { langKey: "dueNextWeek", langText: "任务：设为下周同一天", hotkeys: [HK.nextWeek], run: (d) => setDueTo(d, "nextWeek") },
    { langKey: "dueClear", langText: "任务：清除日期", hotkeys: [HK.clearDue], run: clearDue },
    { langKey: "openPanel", langText: "任务：打开任务面板", hotkeys: [HK.panel], run: openPanel },
    { langKey: "toggleDone", langText: "任务：完成 / 取消完成", hotkeys: [HK.done], run: toggleDone },
];
