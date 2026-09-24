/**
 * 思源的日期约定：`yyyyMMdd`（全天）或 `yyyyMMddHHmm`（有时刻）。
 *
 * 用字符串而不是时间戳的理由：
 *  1. 思源自己的 created / updated 就是这个格式，字符串比较等价于时间比较；
 *  2. QueryView 的 SQL 里可以直接 >= / <= / like '20260925%'；
 *  3. 人可读，块属性面板里手改不容易错。
 */

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export const DATE_LEN = 8;
export const DATETIME_LEN = 12;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Date → `yyyyMMdd` */
export function toDateStr(d: Date): string {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** Date → `yyyyMMddHHmm` */
export function toDateTimeStr(d: Date): string {
    return toDateStr(d) + pad(d.getHours()) + pad(d.getMinutes());
}

/**
 * `yyyyMMdd` / `yyyyMMddHHmm` → Date（本地时区）。
 * 非法输入返回 null，不抛异常。
 */
export function parseDate(input: string | null | undefined): Date | null {
    if (typeof input !== "string") {
        return null;
    }
    const s = input.trim();

    let m = DATE_RE.exec(s);
    if (m) {
        const year = +m[1];
        const month = +m[2];
        const day = +m[3];
        const d = new Date(year, month - 1, day, 0, 0);
        // 回读校验：挡掉 20261332、20260230 这类不存在的日期
        if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
            return d;
        }
        return null;
    }

    m = DATETIME_RE.exec(s);
    if (m) {
        const year = +m[1];
        const month = +m[2];
        const day = +m[3];
        const hour = +m[4];
        const minute = +m[5];
        const d = new Date(year, month - 1, day, hour, minute);
        if (
            d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day &&
            d.getHours() === hour && d.getMinutes() === minute
        ) {
            return d;
        }
        return null;
    }

    return null;
}

/** 8 位 = 全天；12 位 = 有时刻 */
export function isAllDay(input: string | null | undefined): boolean {
    return typeof input === "string" && DATE_RE.test(input.trim());
}

/** 日期串是否是合法值（8 位或 12 位） */
export function isValidDateStr(input: string | null | undefined): boolean {
    return parseDate(input) !== null;
}

/** 加天数，返回新对象（跨月/跨年正确） */
export function addDays(d: Date, n: number): Date {
    const r = new Date(d.getTime());
    r.setDate(r.getDate() + n);
    return r;
}

/** 下周同一天 */
export function nextWeekSameDay(d: Date): Date {
    return addDays(d, 7);
}

/** 今天（本地 00:00） */
export function today(now: Date = new Date()): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 明天 */
export function tomorrow(now: Date = new Date()): Date {
    return addDays(today(now), 1);
}

/** 后天 */
export function dayAfterTomorrow(now: Date = new Date()): Date {
    return addDays(today(now), 2);
}

/**
 * 保留原时间串的「形态」：原来带时刻就带时刻，原来全天就全天。
 * 用于「设为今天」这类操作——不擅自把全天任务变成有时刻。
 */
export function reshape(oldValue: string | null | undefined, target: Date): string {
    return isAllDay(oldValue) ? toDateStr(target) : toDateTimeStr(target);
}
