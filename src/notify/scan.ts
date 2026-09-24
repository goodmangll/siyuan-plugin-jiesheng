/**
 * 扫库 → 待推送事件。
 *
 * 到期判定用的是**字符串比较**：`yyyyMMddHHmm` 的字典序等价于时间序，
 * 所以不需要解析成 Date，也不需要处理时区。
 */

import { parsePriority } from "../model/priority";
import type { RemindEvent, TaskRow } from "./types";

export type { RemindEvent, TaskRow } from "./types";

/** 只认 `yyyyMMddHHmm`；其它一律当作没有 */
const AT_RE = /^\d{12}$/;

export function parseRemindList(raw: string | null | undefined): string[] {
    if (typeof raw !== "string") {
        return [];
    }
    return raw.split(/[\s,]+/).map((x) => x.trim()).filter((x) => AT_RE.test(x));
}

/**
 * 选出「已到点、且还没推过」的事件。
 *
 * - `now` / `cursor` 都是 `yyyyMMddHHmm`
 * - 区间是 **(cursor, now]**：`cursor` 是上次已推到的时刻，闭区间会重复推
 *
 * 结果按 `remindAt` 升序（同一时刻再加 blockId 兜底），保证推送顺序稳定。
 */
export function dueEvents(
    tasks: TaskRow[],
    now: string,
    cursor: string,
): RemindEvent[] {
    const out: RemindEvent[] = [];
    for (const t of tasks ?? []) {
        for (const at of parseRemindList(t.remind)) {
            if (at <= now && at > cursor) {
                out.push({
                    blockId: t.id,
                    title: t.title ?? "",
                    remindAt: at,
                    due: t.due || undefined,
                    pri: parsePriority(t.pri),
                    list: t.list || undefined,
                });
            }
        }
    }
    out.sort((a, b) => a.remindAt.localeCompare(b.remindAt) || a.blockId.localeCompare(b.blockId));
    return out;
}

/**
 * 推进游标到「已推事件里的最大时刻」。
 *
 * **不要用 `now` 推进**：本机时钟回拨时，`now` 会小于上一轮的 `cursor`，
 * 于是区间 `(cursor, now]` 变成空集甚至负集，中间的提醒会被永久漏掉。
 * 只推进到实际推过的时刻，最坏情况是重复推一条，比漏推安全。
 */
export function advanceCursor(cursor: string, events: RemindEvent[]): string {
    let max = cursor;
    for (const e of events ?? []) {
        if (e.remindAt > max) {
            max = e.remindAt;
        }
    }
    return max;
}
