/**
 * 行 → 视图模型 —— **纯函数，全部可单测**。
 *
 * 视图组件只负责画这些东西，所有"这行数据到底该显示成什么"的判断都在这里。
 * 理由和 panelActions 一样：能测的判断就别塞进 JSX。
 */

import { addDays, parseDate, toDateStr } from "../model/date";
import { parsePriority, type Priority } from "../model/priority";

/**
 * SQL 直接给出的原始行（列名与 views/query.ts 的 SELECT_COLS 对应）。
 *
 * ★ 任务 = 文档。标题在 `title`（= blocks.content，**文档块的 markdown 是空的**，真机实测）。
 */
export interface TaskRow {
    id: string;
    /** 文档标题 */
    title: string | null;
    hpath: string | null;
    /** 所在笔记本 id —— 清单的默认来源 */
    box: string | null;
    updated?: string | null;
    pri: string | null;
    due: string | null;
    start: string | null;
    remind: string | null;
    repeat: string | null;
    lst: string | null;
    /** 完成时刻；非空即已完成 */
    done: string | null;
    /** 置顶标记 */
    pin: string | null;
}

export interface ViewTask {
    id: string;
    /** 文档标题 */
    title: string;
    /** 原始 `yyyyMMdd[HHmm]` */
    due: string | null;
    start: string | null;
    /** 8 位日期，给日历与按天分组用 */
    day: string | null;
    priority: Priority;
    /** 清单名；没有则空串 */
    list: string;
    repeat: string | null;
    hasReminder: boolean;
    path: string;
    /** 所在笔记本 id */
    box: string;
    /** 完成时刻（yyyyMMddHHmm）；非空即已完成 */
    done: string | null;
    /** 是否置顶 */
    pinned: boolean;
    isToday: boolean;
    /** 严格早于今天 */
    overdue: boolean;
}

/** 取前 8 位当"天"。不是 8 位数字就当没有。 */
function toDay(v: string | null | undefined): string | null {
    const s = (v ?? "").trim();
    return /^\d{8}/.test(s) ? s.slice(0, 8) : null;
}

/**
 * @param notebookName 该文档所在笔记本的名字。清单默认取它（`custom-list` 可覆盖）。
 */
export function toViewTask(row: TaskRow, today: string, notebookName?: string): ViewTask {
    const due = (row.due ?? "").trim() || null;
    const day = toDay(due);
    return {
        id: row.id,
        // 文档标题直接就是 title，不需要再清洗 kramdown（老模型才要）
        title: (row.title ?? "").trim(),
        due,
        start: (row.start ?? "").trim() || null,
        day,
        priority: parsePriority(row.pri ?? undefined),
        // 清单：显式 custom-list 优先，否则用所在笔记本名
        list: (row.lst ?? "").trim() || (notebookName ?? "").trim(),
        repeat: (row.repeat ?? "").trim() || null,
        hasReminder: (row.remind ?? "").trim() !== "",
        path: row.hpath ?? "",
        box: row.box ?? "",
        done: (row.done ?? "").trim() || null,
        pinned: (row.pin ?? "").trim() !== "",
        // 逾期按**天**判：今天 14:30 已经过点了也不算逾期
        overdue: day !== null && day < today,
        isToday: day === today,
    };
}

/**
 * 批量映射。
 * @param notebooks 笔记本 id → 名字。文档任务默认用它当清单。
 */
export function toViewTasks(
    rows: TaskRow[] | null | undefined,
    today: string,
    notebooks?: Record<string, string>,
): ViewTask[] {
    return (rows ?? []).map((r) => toViewTask(r, today, r.box ? notebooks?.[r.box] : undefined));
}

export interface TaskGroup {
    key: string;
    title: string;
    tasks: ViewTask[];
}

/** 没有清单名时的兜底列名 */
export const INBOX_TITLE = "收件箱";

/** 按清单分组 —— 看板的列。空清单排最后。 */
export function groupByList(tasks: ViewTask[]): TaskGroup[] {
    const map = new Map<string, ViewTask[]>();
    for (const t of tasks) {
        const k = t.list;
        const arr = map.get(k);
        if (arr) {
            arr.push(t);
        } else {
            map.set(k, [t]);
        }
    }
    return [...map.entries()]
        .sort((a, b) => {
            // 空清单（收件箱）永远排最后，否则它按字典序会跑到最前
            if (a[0] === "") return 1;
            if (b[0] === "") return -1;
            return a[0].localeCompare(b[0], "zh");
        })
        .map(([key, ts]) => ({ key, title: key === "" ? INBOX_TITLE : key, tasks: ts }));
}

/** 按天分组 —— 日历与"按日期分组"的列表用。无日期的归到 null 键。 */
export function groupByDay(tasks: ViewTask[]): Map<string | null, ViewTask[]> {
    const map = new Map<string | null, ViewTask[]>();
    for (const t of tasks) {
        const arr = map.get(t.day);
        if (arr) {
            arr.push(t);
        } else {
            map.set(t.day, [t]);
        }
    }
    return map;
}

export type Quadrant = "q1" | "q2" | "q3" | "q4";

/** 「紧急」的判据：有截止日，且落在今天起 3 天内（含已逾期） */
const URGENT_WITHIN_DAYS = 3;

export const QUADRANT_TITLE: Record<Quadrant, string> = {
    q1: "重要且紧急",
    q2: "重要不紧急",
    q3: "紧急不重要",
    q4: "不重要不紧急",
};

/**
 * 四象限落格。重要 = 优先级高或中；紧急 = 3 天内到期。
 * 这是个**约定**，不是客观真理 —— 同类产品的默认划分也是约定，用户可自行改优先级来调整。
 */
export function matrixCell(task: ViewTask, today: string): Quadrant {
    const important = task.priority === "high" || task.priority === "medium";
    const urgent = isUrgent(task, today);
    if (important && urgent) return "q1";
    if (important) return "q2";
    if (urgent) return "q3";
    return "q4";
}

function isUrgent(task: ViewTask, today: string): boolean {
    if (task.day === null) {
        return false;
    }
    const base = parseDate(today);
    if (!base) {
        return false;
    }
    return task.day < toDateStr(addDays(base, URGENT_WITHIN_DAYS + 1));
}

/** `yyyyMMdd` → `MM-DD`；`yyyyMMddHHmm` 额外给出 ` HH:mm` */
function dayLabel(v: string): string {
    const md = `${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return v.length >= 12 ? `${md} ${v.slice(8, 10)}:${v.slice(10, 12)}` : md;
}

function daysBetween(from: string, to: string): number | null {
    const a = parseDate(from);
    const b = parseDate(to);
    return a && b ? Math.round((b.getTime() - a.getTime()) / 86400000) : null;
}

/**
 * 截止日的人类可读形式。列表/卡片都显示这个。
 *
 * 相对说法（今天/明天/昨天/N 天前）只在**今年**用 —— 跨年的「今天 +1」说成"明天"会误导。
 */
export function formatDue(task: ViewTask, today: string): string {
    if (!task.day) {
        return "";
    }
    const diff = daysBetween(today, task.day);
    const sameYear = task.day.slice(0, 4) === today.slice(0, 4);
    if (diff === null || !sameYear) {
        return `${task.day.slice(0, 4)}-${task.day.slice(4, 6)}-${task.day.slice(6, 8)}`;
    }
    const hm = task.due && task.due.length >= 12 ? ` ${task.due.slice(8, 10)}:${task.due.slice(10, 12)}` : "";
    if (diff === 0) return `今天${hm}`;
    if (diff === 1) return `明天${hm}`;
    if (diff === -1) return "昨天";
    if (diff < -1) return `${-diff} 天前`;
    return dayLabel(task.due ?? task.day);
}

/** 看板的另一种分组维度 */
export type BoardGroupBy = "list" | "priority";

const PRI_ORDER: Priority[] = ["high", "medium", "low", "none"];
const PRI_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低", none: "无" };

/**
 * 按优先级分组。**固定 4 列，空的也保留** —— 看板少一列会让人以为拖不过去。
 */
export function groupByPriority(tasks: ViewTask[]): TaskGroup[] {
    return PRI_ORDER.map((p) => ({
        key: p,
        title: PRI_LABEL[p],
        tasks: tasks.filter((t) => t.priority === p),
    }));
}

/**
 * 看图板的列：**已知清单 ∪ 任务里出现的清单**，收件箱永远在第一列。
 *
 * 只用"任务里出现的清单"是不够的 —— 那样一个还没放任务的清单根本不会出现，
 * 用户就**没法把卡片拖进去**（真机踩到：整个看板只有 1 列，所有卡片全堆在收件箱）。
 */
export function listColumns(tasks: ViewTask[], knownLists: string[]): TaskGroup[] {
    const seen = new Set<string>(knownLists);
    for (const t of tasks) {
        seen.add(t.list);
    }
    const keys = [...seen]
        .filter((k) => k !== "")
        .sort((a, b) => a.localeCompare(b, "zh"));
    return ["", ...keys].map((key) => ({
        key,
        title: key === "" ? INBOX_TITLE : key,
        tasks: tasks.filter((t) => t.list === key),
    }));
}

/** 按看板当前的分组维度分组 */
export function boardColumns(tasks: ViewTask[], knownLists: string[], by: BoardGroupBy): TaskGroup[] {
    return by === "priority" ? groupByPriority(tasks) : listColumns(tasks, knownLists);
}
