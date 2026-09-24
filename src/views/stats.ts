/**
 * 统计视图的纯逻辑：日期轴、补零、柱状图几何、分布 SQL。
 *
 * 图表刻意**不引图表库** —— 只用内联 SVG 画柱状图。
 * 理由：这个插件的产物要跟着思源一起跑，多一个图表库就多一份升级负担；
 * 而这里要画的就是"N 天的柱"，用不到库的 1%。
 */

import { addDays, parseDate, toDateStr } from "../model/date";
import { openTasksWhere, attr } from "./query";

/** 近 N 天的日期轴，从早到晚，最后一个是 today */
export function recentDays(today: string, n: number): string[] {
    const base = parseDate(today);
    if (!base) {
        return [];
    }
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        out.push(toDateStr(addDays(base, -i)));
    }
    return out;
}

export interface SeriesPoint {
    day: string;
    value: number;
}

/**
 * 把「按天分组的原始行」铺到完整的日期轴上，缺失的补 0。
 *
 * 不补零的话折线/柱状图会在没有数据的那天断掉 —— 而"那天没干活"本身是重要信息。
 */
export function fillSeries(
    rows: { d: string; c: number }[],
    days: string[],
): SeriesPoint[] {
    const map = new Map<string, number>();
    for (const r of rows) {
        // 可能是 8 位也可能是 12 位带时刻，统一取前 8 位
        const key = (r.d ?? "").slice(0, 8);
        map.set(key, (map.get(key) ?? 0) + (r.c ?? 0));
    }
    return days.map((day) => ({ day, value: map.get(day) ?? 0 }));
}

export interface Bar {
    x: number;
    w: number;
    h: number;
}

/** 柱状图几何：宽度平分，高度按最大值归一。全 0 时高度全 0（不除零）。 */
export function barLayout(values: number[], width: number, height: number): Bar[] {
    const n = values.length;
    if (n === 0) {
        return [];
    }
    const max = Math.max(...values);
    const w = width / n;
    return values.map((v, i) => ({
        x: i * w,
        w,
        h: max > 0 ? (v / max) * height : 0,
    }));
}

/** 按清单分布 */
export function listDistSql(): string {
    return `select coalesce(nullif(${attr("list")}, ''), '未指定') as name, count(*) as c
from blocks b
where ${openTasksWhere()}
group by name
order by c desc`;
}

/** 按优先级分布 */
export function priorityDistSql(): string {
    return `select coalesce(${attr("pri")}, '0') as p, count(*) as c
from blocks b
where ${openTasksWhere()}
group by p
order by p asc`;
}

/**
 * 完成趋势：按 `custom-done` 的日期分组。
 *
 * 区间**止不含**（和 views/query 的区间口径一致）。
 */
export function doneTrendSql(from: string, to: string): string {
    return `select substr(${attr("done")}, 1, 8) as d, count(*) as c
from blocks b
where b.type='i' and b.subtype='t'
  and ${attr("done")} is not null and ${attr("done")} != ''
  and substr(${attr("done")}, 1, 8) >= '${from}'
  and substr(${attr("done")}, 1, 8) < '${to}'
group by d
order by d asc`;
}

/** 新建趋势：按块的 created 日期分组 */
export function createdTrendSql(from: string, to: string): string {
    return `select substr(b.created, 1, 8) as d, count(*) as c
from blocks b
where b.type='i' and b.subtype='t'
  and substr(b.created, 1, 8) >= '${from}'
  and substr(b.created, 1, 8) < '${to}'
group by d
order by d asc`;
}
