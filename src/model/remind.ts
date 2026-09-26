/**
 * 提醒：**存绝对时刻，不存相对偏移**。
 *
 *   存储（custom-remind）：`yyyyMMddHHmm`，多条用空格分隔
 *   面板（UI 层）：        「提前 N 天 09:00」这种偏移语义
 *
 * 为什么不存偏移（iCal TRIGGER 那种，如 `-P2DT15H0M0S`）：
 *   1. 提醒守护是**高频扫库**路径 —— 绝对时刻一句 `like '20260925%'` 就够，存偏移每次都要算；
 *   2. 改截止日 / 重复递推**本来就必须重算**，顺手重算 remind 成本为零；
 *   3. 人可读，块属性面板里能手改。
 * 偏移语义保留在本模块，供面板使用。
 *
 * 偏移语法：
 *   `0`            准点（有时刻用原时刻；全天则当天 09:00）
 *   `-15m`         提前 15 分钟
 *   `-2h`          提前 2 小时
 *   `-3d`          提前 3 天（保留原时刻）
 *   `-2d09:00`     提前 2 天，并设为 09:00
 *   `0d09:00`      当天 09:00
 *   `-1w09:00`     提前 1 周 09:00
 */

import { addDays, isAllDay, parseDate, toDateStr, toDateTimeStr } from "./date";

export const DEFAULT_HOUR = 9; // 全天任务没给时刻时的默认提醒时间

const OFFSET_RE = /^(-?)(\d+)([mhdw])(?:(\d{1,2}):(\d{2}))?$/;
const DEFAULT_TIME = `${String(DEFAULT_HOUR).padStart(2, "0")}:00`;

interface ParsedOffset {
    negative: boolean;
    n: number;
    unit: "m" | "h" | "d" | "w";
    hh: number | null;
    mm: number | null;
}

export function parseOffset(input: string | null | undefined): ParsedOffset | null {
    if (typeof input !== "string") {
        return null;
    }
    const s = input.trim();
    const m = OFFSET_RE.exec(s);
    if (!m) {
        return null;
    }
    const hh = m[4] === undefined ? null : Number(m[4]);
    const mm = m[5] === undefined ? null : Number(m[5]);
    if (hh !== null && (hh > 23 || mm! > 59)) {
        return null;
    }
    return { negative: m[1] === "-", n: Number(m[2]), unit: m[3] as ParsedOffset["unit"], hh, mm };
}

/** 把偏移套到 due 上，得到绝对时刻 `yyyyMMddHHmm`；失败返回 null */
export function offsetToAbsolute(due: string | null | undefined, offset: string | null | undefined): string | null {
    const base = parseDate(due);
    if (!base) {
        return null;
    }
    const allDay = isAllDay(due);

    // 准点
    if (typeof offset === "string" && offset.trim() === "0") {
        return allDay
            ? toDateStr(base) + DEFAULT_TIME.replace(":", "")
            : toDateTimeStr(base);
    }

    const p = parseOffset(offset);
    if (!p) {
        return null;
    }

    // 分钟 / 小时：在「日期+时刻」上直接减
    if (p.unit === "m" || p.unit === "h") {
        const baseTime = allDay
            ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), DEFAULT_HOUR, 0)
            : base;
        const mins = p.unit === "m" ? p.n : p.n * 60;
        const t = baseTime.getTime() - mins * 60 * 1000;
        return toDateTimeStr(new Date(t));
    }

    // 天 / 周：改日期，时刻由偏移指定或沿用
    const days = p.n * (p.unit === "w" ? 7 : 1);
    const day = p.negative ? addDays(base, -days) : addDays(base, days);
    if (p.hh !== null) {
        return `${toDateStr(day)}${String(p.hh).padStart(2, "0")}${String(p.mm).padStart(2, "0")}`;
    }
    return allDay
        ? toDateStr(day) + DEFAULT_TIME.replace(":", "")
        : toDateTimeStr(day);
}

// ── 多条提醒的序列化 ──────────────────────────────────────────────────────────

export function parseOffsets(raw: string | null | undefined): string[] {
    if (typeof raw !== "string") {
        return [];
    }
    return raw
        .split(/[\s\n,]+/)
        .map((x) => x.trim())
        .filter((x) => /^\d{8}(\d{4})?$/.test(x));
}

export function formatOffsets(list: string[]): string {
    return list.filter((x) => /^\d{8}(\d{4})?$/.test(x)).join(" ");
}

/**
 * 多条提醒按 due 重算。
 * `rearm` 里的每条是「相对偏移」；已经展开成绝对时刻的条目调用方自行保留。
 */
export function rearm(offsets: string[], due: string | null | undefined): string[] {
    return offsets
        .map((o) => offsetToAbsolute(due, o))
        .filter((x): x is string => x !== null);
}

// ── 与 iCal TRIGGER 互转（互操作用，本插件内部不用） ───────────────────────────

/**
 * 偏移 → iCal TRIGGER（如 `-P1DT15H0M0S`）。
 *
 * iCal 的 TRIGGER 是**相对事件开始时刻**的时长。本插件的偏移里，`m`/`h`/`d`/`w`
 * 这几种纯单位形式本身就等价于一个时长；而带 `HH:mm` 的形式（如 `-2d09:00`）
 * **只在 due 是全天时才有确定的时长含义** —— 否则同一个偏移会随 due 的具体时刻而变。
 * 因此：本函数对带 `HH:mm` 的形式**假定 due 为全天（00:00）**，并在此前提下换算。
 *
 * 另：周偏移会被规范化成天（`-1w09:00` ⟺ `-7d09:00` ⟺ `-P6DT15H0M0S`），因为语义等价。
 */
export function toICalTrigger(offset: string | null | undefined): string | null {
    if (typeof offset !== "string") {
        return null;
    }
    if (offset.trim() === "0") {
        return "-PT0S";
    }
    const p = parseOffset(offset);
    if (!p) {
        return null;
    }
    const sign = p.negative ? -1 : 1;
    const dayCount = p.n * (p.unit === "w" ? 7 : 1);

    let minutes: number;
    switch (p.unit) {
        case "m":
            minutes = sign * p.n;
            break;
        case "h":
            minutes = sign * p.n * 60;
            break;
        default: // d / w
            minutes = sign * dayCount * 1440;
            if (p.hh !== null) {
                minutes += p.hh * 60 + (p.mm ?? 0);
            } else if (sign < 0) {
                // `-3d`（保留原时刻）在「due 为全天」前提下就是 −3 天整
                minutes += 0;
            }
            break;
    }

    const neg = minutes < 0;
    const abs = Math.abs(minutes);
    if (abs === 0) {
        return "-PT0S";
    }
    const d = Math.floor(abs / 1440);
    const h = Math.floor((abs % 1440) / 60);
    const m = abs % 60;
    // iCal 规范最简形式：为 0 的部件省略（`-PT5M` 而不是 `-P0DT0H5M0S`）
    // 注意：`-P2DT15H0M0S` 这种「带零」写法也要认，字面不同但时长等价；
    // fromICalTrigger 两种都能解析。
    const datePart = d > 0 ? `${d}D` : "";
    const timePart = [h > 0 ? `${h}H` : "", m > 0 ? `${m}M` : ""].join("") || "0S";
    return `${neg ? "-" : ""}P${datePart}T${timePart}`;
}

/**
 * iCal TRIGGER → 偏移。与 `toICalTrigger` 互逆（周会被规范化成天）。
 *
 *   `-PT5M`         → `-5m`
 *   `-PT2H0M0S`     → `-2h`
 *   `P0DT9H0M0S`    → `0d09:00`   （正的、小于一天的时长 = 当天稍晚的时刻）
 *   `-P6DT15H0M0S`  → `-7d09:00`  （−6d15h 从午夜起算 = 前 7 天的 09:00）
 *   `-PT0S`         → `0`
 */
export function fromICalTrigger(trigger: string | null | undefined): string | null {
    if (typeof trigger !== "string") {
        return null;
    }
    const m = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(trigger.trim());
    if (!m) {
        return null;
    }
    const neg = m[1] === "-";
    const total = Number(m[2] ?? 0) * 1440 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
    if (total === 0) {
        return "0";
    }

    // 小于一天：负的用「提前 N 分/时」，正的用「当天 HH:mm」
    if (total < 1440) {
        if (neg) {
            return total % 60 === 0 ? `-${total / 60}h` : `-${total}m`;
        }
        const hh = String(Math.floor(total / 60)).padStart(2, "0");
        const mm = String(total % 60).padStart(2, "0");
        return `0d${hh}:${mm}`;
    }

    // 一天以上：归一化成「第 N 天的 HH:mm」（向下取整，负数也正确）
    const signed = neg ? -total : total;
    const dayShift = Math.floor(signed / 1440);
    const timeOfDay = signed - dayShift * 1440;
    const hh = String(Math.floor(timeOfDay / 60)).padStart(2, "0");
    const mm = String(timeOfDay % 60).padStart(2, "0");
    return `${dayShift < 0 ? "-" : ""}${Math.abs(dayShift)}d${hh}:${mm}`;
}

/**
 * 提醒平移：截止日变了多少，提醒就跟着挪多少。
 *
 * 这是「存绝对时刻」这个决定的**代价补偿**：用户看到的语义是「提前 2 天」，
 * 换了截止日之后提醒要跟着走。不做这一步，提醒就会原地不动，语义就断了。
 * 面板改日期、重复任务递推，两处都要用。
 */
export function shiftReminders(
    reminders: string[],
    oldDue: string | null | undefined,
    newDue: string | null | undefined,
): string[] {
    const from = parseDate(oldDue);
    const to = parseDate(newDue);
    const list = reminders ?? [];
    if (!from || !to || list.length === 0 || from.getTime() === to.getTime()) {
        return [...list];
    }

    const dayDelta = dayDiff(from, to);
    return list.map((r) => {
        const d = parseDate(r);
        if (!d) {
            return r;
        }
        if (isSameDay(d, from)) {
            // **同一天**的提醒 = 「提前 5 分钟」「准点」这类 —— 用户想的是
            // 「离截止差多久」，所以保持与 due 的相对距离，due 挪多少它挪多少。
            const offsetMin = Math.round((d.getTime() - from.getTime()) / 60000);
            return fmt(new Date(to.getTime() + offsetMin * 60000));
        }
        // **不同天**的提醒 = 「提前 N 天 09:00」这类 —— 用户想的是
        // 「在截止日前第 N 天的 09:00」，所以按天平移、**钟点不动**。
        //
        // 为什么必须和上面分开：我们只存绝对时刻，原始偏移已经丢了。
        // 若一律按分钟挪，把「9/25 14:30」改成全天的「9/27」会算出 +2天9.5小时，
        // 提醒被推到 9/26 18:30 这种毫无意义的位置（真机实测踩到过）。
        const shifted = new Date(d.getTime());
        shifted.setDate(shifted.getDate() + dayDelta);
        return fmt(shifted);
    });
}

/** 是否同一个自然日 */
function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 相差几个自然日（按本地日历天算，避开时刻与夏令时干扰） */
function dayDiff(a: Date, b: Date): number {
    const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / 86400000);
}

function fmt(d: Date): string {
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;
}
const p2 = (n: number): string => String(n).padStart(2, "0");
