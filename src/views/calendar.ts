/**
 * 日历的纯逻辑：月份网格、翻月、标题。
 *
 * 日历是边界错误的重灾区（跨年、闰年、31 号翻到 30 天的月份……），
 * 所以这部分一个字都不放进组件里 —— 全部纯函数 + 单测。
 */

const WEEK_HEADERS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** 表头：周一开始（国内习惯） */
export function weekdayHeaders(): readonly string[] {
    return WEEK_HEADERS;
}

/** 固定 6 行 —— 行数随月份变会让整个网格上下跳 */
const ROWS = 6;

export interface GridCell {
    /** `yyyyMMdd` */
    day: string;
    /** 是否属于当前展示的月份（不属于的画灰） */
    inMonth: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const fmt = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** 取某天的 0 点，避免夏令时/时分秒干扰加减 */
function atMidnight(y: number, m: number, d: number): Date {
    return new Date(y, m, d);
}

/**
 * 月份网格。锚点可以是该月任意一天。
 *
 * 起点回退到**包含 1 号的那一周的周一**，然后连续排 6×7 天。
 */
export function monthGrid(anchor: string): GridCell[][] {
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(4, 6)) - 1;
    const first = atMidnight(y, m, 1);

    // JS 的 getDay()：0=周日。转成「距离周一几天」
    const offset = (first.getDay() + 6) % 7;
    const start = atMidnight(y, m, 1 - offset);

    const cells: GridCell[][] = [];
    for (let r = 0; r < ROWS; r++) {
        const row: GridCell[] = [];
        for (let c = 0; c < 7; c++) {
            const d = atMidnight(start.getFullYear(), start.getMonth(), start.getDate() + r * 7 + c);
            row.push({ day: fmt(d), inMonth: d.getMonth() === m && d.getFullYear() === y });
        }
        cells.push(row);
    }
    return cells;
}

/**
 * 翻月。锚点日会**收敛到目标月的最后一天**，不溢出到下个月。
 *
 * 不这么做的话：1/31 往后一个月 → JS 的 `new Date(2026, 1, 31)` 会变成 3/3，
 * 用户点"下一月"会直接跳过 2 月。
 */
export function shiftMonth(anchor: string, delta: number): string {
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(4, 6)) - 1;
    const d = Number(anchor.slice(6, 8));

    const target = new Date(y, m + delta, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return fmt(atMidnight(target.getFullYear(), target.getMonth(), Math.min(d, lastDay)));
}

/** `yyyyMMdd` → `2026 年 9 月` */
export function monthLabel(anchor: string): string {
    return `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(4, 6))} 月`;
}
