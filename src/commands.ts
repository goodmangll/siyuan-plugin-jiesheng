/**
 * 命令层：把「快捷键」翻译成「对任务块的属性写入」。
 *
 * 这一层**不碰任何 UI 与思源 API**，全部依赖注入，因此可以完整单测。
 * 快捷键空间的选择依据见《M0 验证报告》§3：`Alt+Shift+*` 实测 104 个组合空闲，
 * 而同类产品原本的 `Tab+*` / `Alt+数字` 在思源里分别「不触发」和「被内置占用」。
 */

import { ATTR } from "./model/attrs";
import { priorityAttr, type Priority } from "./model/priority";
import { isDone, isTaskKramdown, setTaskDone } from "./model/task";
import { patchDue, type DueKind } from "./ui/panelActions";

// 转出去：调用方一直在 `./commands` 里拿 DueKind
export type { DueKind };

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
    /** 打开任务视图 Tab */
    openTaskTab?(): void;
    /** 切换置顶 */
    togglePin?(id: string, attrs: Record<string, string>): Promise<void>;
    /** 打开插件设置 */
    openSettings?(): void;
    /** 当前被整块选中的块数（用于 T18 的多选提示） */
    selectedBlockCount?(): number;
    /** 任务**刚变成完成**时回调（重复任务生成挂在这里） */
    onCompleted?(id: string): Promise<void> | void;
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
    // T18：选中多个块时只作用于光标那一个。不装作没看见 —— 明说一次。
    if ((deps.selectedBlockCount?.() ?? 0) > 1) {
        deps.toast?.("任务流：选中了多个块，本次只作用于光标所在的那一个");
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


/**
 * 设为今天 / 明天 / 下周 —— **保留原有的时刻形态**：
 * 原本是全天就仍是全天，原本有时刻就换日期不换时刻。
 */
export async function setDueTo(deps: TaskCommandDeps, kind: DueKind): Promise<void> {
    // 这里曾经是**一份重复实现**：只写 custom-due，不管提醒。
    // 结果就是「面板改日期提醒会跟着走、快捷键改日期不会」——
    // 同一个语义两条路各写各的。现在统一走 patchDue。
    await withTask(deps, async (id, attrs) => {
        await deps.writeAttrs(id, patchDue(attrs, kind, deps.now()));
    });
}

/** 清除日期：只动 custom-due */
export async function clearDue(deps: TaskCommandDeps): Promise<void> {
    await withTask(deps, async (id, attrs) => {
        // 同样走 patchDue：清除日期时提醒一并清掉（提醒指向一个不存在的日期没有意义）
        await deps.writeAttrs(id, patchDue(attrs, "clear", deps.now()));
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
    const wasDone = isDone(kr);
    const next = setTaskDone(kr, !wasDone);
    if (next === null) {
        deps.toast?.("任务流：无法切换完成状态");
        return;
    }
    await deps.writeKramdown(id, next);

    // 刚变成「完成」时才触发生成；取消完成不该生成
    if (!wasDone && deps.onCompleted) {
        try {
            await deps.onCompleted(id);
        } catch {
            // 生成失败不能让「完成任务」这个动作失败
        }
    }
}

/** 打开设置 */
export async function openSettings(deps: TaskCommandDeps): Promise<void> {
    deps.openSettings?.();
}

/**
 * 置顶 / 取消置顶。
 *
 * ★ 不用 `moveBlock` 去挪文档顺序：实测那套 API 在同层重排上**不可靠**，
 *   而且有一次确定的**块销毁**记录（非确定性）。视图的排序本来就是我们控制的，
 *   所以置顶就用一个属性 + 排序键 —— 语义准确、行为确定。
 */
export async function togglePin(deps: TaskCommandDeps): Promise<void> {
    await withTask(deps, async (id, attrs) => {
        const pinned = (attrs[ATTR.pin] ?? "").trim() !== "";
        await deps.writeAttrs(id, { [ATTR.pin]: pinned ? "" : "1" });
        deps.toast?.(pinned ? "已取消置顶" : "已置顶");
    });
}

/** 打开任务视图 Tab（今天/收件箱/看板/日历…） */
export async function openTaskTab(deps: TaskCommandDeps): Promise<void> {
    deps.openTaskTab?.();
}

/** 打开任务面板 */
export async function openPanel(deps: TaskCommandDeps): Promise<void> {
    const id = await currentTaskBlockId(deps);
    if (!id) {
        return;
    }
    // 带上 focus：设计 T8 要求「面板打开且日期区获得焦点」
    deps.openPanel(id, "due");
}

// ── 命令表 ───────────────────────────────────────────────────────────────────

const HK = {
    p1: "\u2325\u21e71", p2: "\u2325\u21e72", p3: "\u2325\u21e73", p0: "\u2325\u21e70",
    today: "\u2325\u21e7Q", tomorrow: "\u2325\u21e7W", nextWeek: "\u2325\u21e7E", clearDue: "\u2325\u21e7X",
    panel: "\u2325\u21e7D", done: "\u2325\u21e7M",
    taskTab: "\u2325\u21e7T",
    pin: "\u2325\u21e7U",
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
    { langKey: "openTaskTab", langText: "任务：打开任务视图（今天/看板/日历）", hotkeys: [HK.taskTab], run: openTaskTab },
    { langKey: "togglePin", langText: "任务：置顶 / 取消置顶", hotkeys: [HK.pin], run: togglePin },
    // 不占快捷键：设置不常用，而且思源插件列表里本来就有齿轮入口
    { langKey: "openSettings", langText: "任务：打开提醒设置", hotkeys: [], run: openSettings },
];
