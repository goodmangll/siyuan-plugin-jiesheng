/**
 * 重复规则：RFC 5545 RRULE 的一个子集，**全部塞进一个属性** `custom-repeat`。
 *
 *   FREQ=DAILY
 *   FREQ=WEEKLY;BYDAY=FR
 *   FREQ=WEEKLY;INTERVAL=2;BYDAY=FR
 *   FREQ=MONTHLY;BYMONTHDAY=25
 *   FREQ=MONTHLY;BYMONTHDAY=-1          ← 每月最后一天
 *   FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=25
 *   FREQ=DAILY;UNTIL=20261231
 *   FREQ=DAILY;COUNT=5
 *   FREQ=DAILY;EXDATE=20261001,20261002
 *
 * COUNT 的语义是「剩余次数」，由生成器在每次递推时递减写回；
 * 本模块只负责「剩余为 0 就不再产生」。
 *
 * 不做：LUNAR（农历）、BYWEEKNO / BYYEARDAY / BYSETPOS 等冷门部件、节假日（需要节假日数据源）。
 */

import { toDateStr } from "./date";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RepeatRule {
    freq: Freq;
    interval: number;
    byDay?: string[];
    byMonth?: number[];
    byMonthDay?: number[];
    until?: string;
    count?: number;
    exDate?: string[];
}

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
/** 递推搜索上界：8 年。够了，再远也没人看。 */
const MAX_SCAN_DAYS = 366 * 8;

/** 索引 0 = 周一，与 RRULE 的 BYDAY 顺序一致 */
const BYDAY_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Date → BYDAY 码 */
export function dayCode(d: Date): string {
    return BYDAY_ORDER[(d.getDay() + 6) % 7];
}

const pad = (n: number) => String(n).padStart(2, "0");

function daysInMonth(year: number, month1: number): number {
    return new Date(year, month1, 0).getDate();
}

/** 以周一为起点的周起始日 */
function weekStart(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

function diffDays(a: Date, b: Date): number {
    const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((y - x) / DAY);
}

function monthIndex(d: Date): number {
    return d.getFullYear() * 12 + d.getMonth();
}

// ── 解析 / 序列化 ────────────────────────────────────────────────────────────

export function parseRule(input: string | null | undefined): RepeatRule | null {
    if (typeof input !== "string") {
        return null;
    }
    const s = input.trim();
    if (!s) {
        return null;
    }
    const parts = s.split(";").filter(Boolean);
    const map = new Map<string, string>();
    for (const p of parts) {
        const i = p.indexOf("=");
        if (i <= 0) {
            return null;
        }
        map.set(p.slice(0, i).toUpperCase(), p.slice(i + 1));
    }

    const freqRaw = (map.get("FREQ") ?? "").toUpperCase() as Freq;
    if (!FREQS.includes(freqRaw)) {
        return null;
    }

    const rule: RepeatRule = { freq: freqRaw, interval: 1 };

    if (map.has("INTERVAL")) {
        const n = Number(map.get("INTERVAL"));
        if (!Number.isInteger(n) || n < 1) {
            return null;
        }
        rule.interval = n;
    }
    if (map.has("BYDAY")) {
        const days = map.get("BYDAY")!.split(",").map((x) => x.trim().toUpperCase());
        if (days.some((d) => !(BYDAY_ORDER as readonly string[]).includes(d))) {
            return null;
        }
        rule.byDay = days;
    }
    if (map.has("BYMONTH")) {
        const ms = map.get("BYMONTH")!.split(",").map(Number);
        if (ms.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
            return null;
        }
        rule.byMonth = ms;
    }
    if (map.has("BYMONTHDAY")) {
        const ds = map.get("BYMONTHDAY")!.split(",").map(Number);
        if (ds.some((d) => !Number.isInteger(d) || d === 0 || d < -31 || d > 31)) {
            return null;
        }
        rule.byMonthDay = ds;
    }
    if (map.has("UNTIL")) {
        const u = map.get("UNTIL")!.trim();
        if (!/^\d{8}$/.test(u)) {
            return null;
        }
        rule.until = u;
    }
    if (map.has("COUNT")) {
        const c = Number(map.get("COUNT"));
        if (!Number.isInteger(c) || c < 0) {
            return null;
        }
        rule.count = c;
    }
    if (map.has("EXDATE")) {
        const xs = map.get("EXDATE")!.split(",").map((x) => x.trim()).filter(Boolean);
        if (xs.some((x) => !/^\d{8}$/.test(x))) {
            return null;
        }
        rule.exDate = xs;
    }

    return rule;
}

export function formatRule(rule: RepeatRule): string {
    const out: string[] = [`FREQ=${rule.freq}`];
    if (rule.interval !== 1) {
        out.push(`INTERVAL=${rule.interval}`);
    }
    if (rule.byDay?.length) {
        out.push(`BYDAY=${rule.byDay.join(",")}`);
    }
    if (rule.byMonth?.length) {
        out.push(`BYMONTH=${rule.byMonth.join(",")}`);
    }
    if (rule.byMonthDay?.length) {
        out.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
    }
    if (rule.until) {
        out.push(`UNTIL=${rule.until}`);
    }
    if (rule.count !== undefined) {
        out.push(`COUNT=${rule.count}`);
    }
    if (rule.exDate?.length) {
        out.push(`EXDATE=${rule.exDate.join(",")}`);
    }
    return out.join(";");
}

// ── 预设 ─────────────────────────────────────────────────────────────────────

export type PresetId =
    | "daily" | "weekly" | "monthly" | "yearly"
    | "workday" | "weekend" | "biweekly" | "monthEnd";

export const PRESETS: { id: PresetId; label: string }[] = [
    { id: "daily", label: "每天" },
    { id: "weekly", label: "每周" },
    { id: "monthly", label: "每月" },
    { id: "yearly", label: "每年" },
    { id: "workday", label: "工作日" },
    { id: "weekend", label: "周末" },
    { id: "biweekly", label: "隔周" },
    { id: "monthEnd", label: "每月最后一天" },
];

/**
 * 预设 → RRULE 串。anchor 决定「每周几 / 每月几号 / 每年几月几号」。
 * 注意：`biweekly` 同时用到 anchor 的星期与「隔一周」的基准（anchor 所在周为第 0 周）。
 */
export function fromPreset(id: PresetId, anchor: Date): string {
    const day = dayCode(anchor);
    switch (id) {
        case "daily":
            return formatRule({ freq: "DAILY", interval: 1 });
        case "weekly":
            return formatRule({ freq: "WEEKLY", interval: 1, byDay: [day] });
        case "monthly":
            return formatRule({ freq: "MONTHLY", interval: 1, byMonthDay: [anchor.getDate()] });
        case "yearly":
            return formatRule({
                freq: "YEARLY", interval: 1,
                byMonth: [anchor.getMonth() + 1], byMonthDay: [anchor.getDate()],
            });
        case "workday":
            return formatRule({ freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] });
        case "weekend":
            return formatRule({ freq: "WEEKLY", interval: 1, byDay: ["SA", "SU"] });
        case "biweekly":
            return formatRule({ freq: "WEEKLY", interval: 2, byDay: [day] });
        case "monthEnd":
            return formatRule({ freq: "MONTHLY", interval: 1, byMonthDay: [-1] });
    }
}

// ── 递推 ─────────────────────────────────────────────────────────────────────

/** 日期是否满足规则（不含 until / exdate 这些「中断」条件） */
function matches(rule: RepeatRule, d: Date, anchor: Date): boolean {
    switch (rule.freq) {
        case "DAILY":
            return diffDays(anchor, d) % rule.interval === 0;
        case "WEEKLY": {
            const days = rule.byDay?.length ? rule.byDay : [dayCode(anchor)];
            if (!days.includes(dayCode(d))) {
                return false;
            }
            const weeks = Math.round((weekStart(d).getTime() - weekStart(anchor).getTime()) / WEEK);
            return weeks % rule.interval === 0;
        }
        case "MONTHLY": {
            const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
            const wanted = rule.byMonthDay?.length ? rule.byMonthDay : [anchor.getDate()];
            const hit = wanted.some((v) => (v > 0 ? v === d.getDate() : dim + v + 1 === d.getDate()));
            if (!hit) {
                return false;
            }
            return (monthIndex(d) - monthIndex(anchor)) % rule.interval === 0;
        }
        case "YEARLY": {
            const months = rule.byMonth?.length ? rule.byMonth : [anchor.getMonth() + 1];
            const mds = rule.byMonthDay?.length ? rule.byMonthDay : [anchor.getDate()];
            if (!months.includes(d.getMonth() + 1)) {
                return false;
            }
            const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
            if (!mds.some((v) => (v > 0 ? v === d.getDate() : dim + v + 1 === d.getDate()))) {
                return false;
            }
            return (d.getFullYear() - anchor.getFullYear()) % rule.interval === 0;
        }
    }
}

/**
 * 严格晚于 `from` 的第一个重复日期；没有则返回 null。
 * `anchor` 是这条重复的基准日（通常是任务最初的截止日），RRULE 的 INTERVAL 以它为第 0 期。
 */
export function nextOccurrence(rule: RepeatRule, from: Date, anchor: Date): Date | null {
    if (rule.count !== undefined && rule.count <= 0) {
        return null;
    }
    const until = rule.until;
    const skip = new Set(rule.exDate ?? []);

    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
        cursor.setDate(cursor.getDate() + 1);
        const key = toDateStr(cursor);
        if (until && key > until) {
            return null;
        }
        if (!matches(rule, cursor, anchor)) {
            continue;
        }
        if (skip.has(key)) {
            continue;
        }
        return new Date(cursor.getTime());
    }
    return null;
}

/** 把一条规则翻译成人话，用于面板与 SQL 注释 */
export function describeRule(rule: RepeatRule): string {
    const every = rule.interval === 1 ? "" : `每 ${rule.interval} `;
    const cnDay: Record<string, string> = {
        MO: "周一", TU: "周二", WE: "周三", TH: "周四", FR: "周五", SA: "周六", SU: "周日",
    };
    switch (rule.freq) {
        case "DAILY":
            return rule.interval === 1 ? "每天" : `${every}天`;
        case "WEEKLY": {
            const days = (rule.byDay ?? []).map((d) => cnDay[d] ?? d);
            const joined = days.join("、");
            if (joined === "周一、周二、周三、周四、周五") {
                return rule.interval === 1 ? "工作日" : `${every}周的工作日`;
            }
            if (joined === "周六、周日") {
                return rule.interval === 1 ? "周末" : `${every}周的周末`;
            }
            return `${every}周 ${joined}`;
        }
        case "MONTHLY": {
            const d = rule.byMonthDay?.[0];
            if (d === -1) {
                return `${every}月最后一天`;
            }
            return `${every}月 ${d ?? "?"} 日`;
        }
        case "YEARLY": {
            const m = rule.byMonth?.[0];
            const d = rule.byMonthDay?.[0];
            return `${every}年 ${m ?? "?"} 月 ${d ?? "?"} 日`;
        }
    }
}

/** 便于测试与调试：日期串 */
export function occurrenceStr(rule: RepeatRule, from: Date, anchor: Date): string | null {
    const d = nextOccurrence(rule, from, anchor);
    return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
}
