/**
 * 重复任务递推：一个已完成的任务 → 下一个未完成的任务该长什么样。
 *
 * **纯函数**：不碰思源 API、不碰 DOM，只算「新任务的属性应该是多少」。
 * 真正的写回（插块 + 写属性）在 api/命令层。
 *
 * 关于 RRULE 的 anchor：**不需要额外存「系列起始日」**。
 * 因为每次生成出来的 due 本身就是一次 occurrence，拿它当 anchor 相位永远正确 ——
 * 隔周 `INTERVAL=2` 不会漂移（9/25 → 10/9 → 10/23）。少一个属性。
 */

import { isAllDay, parseDate, toDateStr } from "./date";
import type { Priority } from "./priority";
import { shiftReminders } from "./remind";
import { formatRule, nextOccurrence, type RepeatRule } from "./repeat";

export interface RepeatTaskMeta {
    /** 当前任务的截止日 */
    due?: string;
    /** 当前任务的开始时刻 */
    start?: string;
    /** 当前任务的提醒（绝对时刻） */
    remind: string[];
    /** 重复规则；为 null 表示不是重复任务 */
    repeat: RepeatRule | null;
    /** `due`（从截止日递推，默认）或 `done`（从完成日递推） */
    repeatFrom?: string;
    list?: string;
    pri: Priority;
}

export interface NextRepeatTask {
    /** 下一个任务的截止日 */
    due?: string;
    /** 下一个任务的开始时刻 */
    start?: string;
    /** 下一个任务的提醒（已按 delta 平移） */
    remind: string[];
    /** 更新后的 RRULE（COUNT 已递减） */
    repeat: string;
}

/** Date → 当天的本地 00:00（递推按天算，时刻在后面再补回去） */
function toDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 日期串 → 年/月/日 的本地 Date（丢掉时刻，递推按天算） */
function dayOf(v: string | undefined, fallback: Date): Date {
    const d = parseDate(v);
    if (!d) {
        return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 递推。返回 null 表示**系列结束**（没有规则 / UNTIL 已过 / COUNT 用尽 / 找不到下一次）。
 *
 * `doneAt` 是这次完成的时刻，只有 `repeatFrom === "done"` 时才会用到它。
 */
export function nextRepeatTask(meta: RepeatTaskMeta, doneAt: Date): NextRepeatTask | null {
    const rule = meta.repeat;
    if (!rule || typeof rule !== "object" || typeof rule.freq !== "string") {
        return null;
    }

    const dueDate = parseDate(meta.due);
    const anchor = dueDate ?? doneAt;
    const from = meta.repeatFrom === "done" ? doneAt : (dueDate ?? doneAt);

    // 注意：这里必须用 `from` 本身，不能再用 meta.due 兜底 ——
    // 否则 repeatFrom="done" 会被悄悄忽略（曾经就是这么错的，测试抓到了）
    const next = nextOccurrence(rule, toDay(from), toDay(anchor));
    if (!next) {
        return null;
    }

    // 保留原 due 的「形态」：原来全天就全天，原来有时刻就带时刻
    const nextDue = !meta.due || isAllDay(meta.due)
        ? toDateStr(next)
        : toDateStr(next) + meta.due.slice(8, 12);

    // start / remind 按与 due 相同的 delta 平移
    const oldDay = dayOf(meta.due, from);
    const newDay = dayOf(nextDue, next);
    const shift = (v: string): string => {
        const d = parseDate(v);
        if (!d) {
            return v;
        }
        const deltaMin = Math.round((newDay.getTime() - oldDay.getTime()) / 60000);
        const t = new Date(d.getTime() + deltaMin * 60000);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}${pad(t.getHours())}${pad(t.getMinutes())}`;
    };

    const nextRule: RepeatRule = { ...rule };
    if (typeof rule.count === "number") {
        nextRule.count = rule.count - 1;
    }

    return {
        due: nextDue,
        start: meta.start ? shift(meta.start) : undefined,
        // 没有当前 due 时无法知道「提前多少」，只能原样保留（已知限制，已在测试里标注）
        remind: meta.due ? shiftReminders(meta.remind ?? [], meta.due, nextDue) : [...(meta.remind ?? [])],
        repeat: formatRule(nextRule),
    };
}
