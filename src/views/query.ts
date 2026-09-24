/**
 * 视图层的 SQL 构建 —— **纯函数，全部可单测**。
 *
 * 抽这一层的原因很直接：SQL 是这套视图里最容易出错、又最难靠"看界面"发现错的部分。
 * 界面少一条任务，你未必看得出来；但 SQL 少一个谓词，单测立刻红。
 *
 * 之前那 14 个 QueryView 视图就是反例 —— 子任务排除谓词**全部漏了**，
 * 靠肉眼看界面根本发现不了。搬进插件时用单测钉住。
 */

import { addDays, parseDate, toDateStr } from "../model/date";

/**
 * 属性子查询。`b` 是外层 blocks 的别名。
 *
 * ⚠️ **属性不在 blocks 表上，在 attributes 表里。** 任何地方写 `b.due` / `b.pri`
 *    都会得到 `no such column: b.due` —— 真机踩过（Tab 一打开就报）。
 *    所以 WHERE / ORDER BY 里也必须用这个子查询，不能图省事写 b.xxx。
 */
export const attr = (name: string): string =>
    `(select value from attributes where block_id=b.id and name='custom-${name}')`;

/** 截止日表达式（WHERE 里用的就是它，不是 b.due） */
const DUE = attr("due");

/** 统一取的列（配合 `from blocks b`） */
export const SELECT_COLS = `b.id, b.markdown, b.hpath, b.root_id, b.updated,
       ${attr("pri")} as pri, ${attr("due")} as due, ${attr("start")} as start,
       ${attr("remind")} as remind, ${attr("repeat")} as repeat, ${attr("list")} as lst`;

/**
 * 基础谓词：未完成的任务项，**并且不是别人的子任务**。
 *
 * 子任务也是 `i/t`，不加下面这段就会混进"顶层待办"里。
 * 判据：父块是列表块 `l`，祖父块是任务项 `i/t`。
 */
export function openTasksWhere(): string {
    return [
        "b.type='i' and b.subtype='t' and b.markdown like '- [ ]%'",
        `not exists (
      select 1 from blocks p join blocks g on g.id = p.parent_id
      where p.id = b.parent_id and p.type='l' and g.type='i' and g.subtype='t'
    )`,
    ].join(" and ");
}

export type SmartListId = "today" | "tomorrow" | "next7" | "inbox" | "all";

export function smartListIds(): SmartListId[] {
    return ["today", "tomorrow", "next7", "inbox", "all"];
}

export interface SqlOptions {
    /** 今天，`yyyyMMdd`。日期比较全靠字符串前缀，所以必须传进来而不是用数据库的 now。 */
    today: string;
    limit?: number;
}

const DEFAULT_LIMIT = 300;

/** 日期串加天数；解析不了就原样返回（宁可查询退化，也不要抛） */
function plusDays(day: string, n: number): string {
    const d = parseDate(day);
    return d ? toDateStr(addDays(d, n)) : day;
}

/**
 * 智能清单的日期条件。
 *
 * due 存的是 `yyyyMMdd` 或 `yyyyMMddHHmm`，**字符串比较即时间比较**，
 * 所以这里全部用比较而不是日期函数 —— 也能吃到 `name='custom-due'` 的索引。
 */
function smartDateWhere(id: SmartListId, today: string): string {
    switch (id) {
        case "today":
            // 同类产品的「今天」= 今天到期 **加上** 已逾期未完成，这是它的默认行为
            return `(${DUE} like '${today}%' or ${DUE} < '${today}')`;
        case "tomorrow":
            return `${DUE} like '${plusDays(today, 1)}%'`;
        case "next7":
            // 明天 ~ 第 7 天（含），所以上界取第 8 天且不含
            return `(${DUE} >= '${plusDays(today, 1)}' and ${DUE} < '${plusDays(today, 8)}')`;
        case "inbox":
            return `${DUE} is null`;
        case "all":
            return "1=1";
        default: {
            const never: never = id;
            throw new Error(`未知的智能清单：${String(never)}`);
        }
    }
}

/** 排序：优先级升序（1 高在前）、无优先级靠后；再按截止日；再按更新时间 */
function orderBy(): string {
    return `order by (${attr("pri")} is null) asc, ${attr("pri")} asc, ${DUE} asc, b.updated desc`;
}

function assertId(id: string): SmartListId {
    if (!smartListIds().includes(id as SmartListId)) {
        // 不能静默退化成"全表"—— 那样视图会莫名其妙显示一堆东西
        throw new Error(`未知的智能清单：${id}`);
    }
    return id as SmartListId;
}

export function listSql(id: string, opts: SqlOptions): string {
    const list = assertId(id);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return `select ${SELECT_COLS}
from blocks b
where ${openTasksWhere()} and ${smartDateWhere(list, opts.today)}
${orderBy()}
limit ${limit}`;
}

/** 计数。**条件部分必须与 listSql 同源**，否则侧边栏数字和列表会对不上。 */
export function countSql(id: string, opts: SqlOptions): string {
    const list = assertId(id);
    return `select count(*) as c
from blocks b
where ${openTasksWhere()} and ${smartDateWhere(list, opts.today)}`;
}

/** 看板：按清单分组，取全部未完成 */
export function boardSql(opts: SqlOptions): string {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return `select ${SELECT_COLS}, coalesce(${attr("list")}, '') as grp
from blocks b
where ${openTasksWhere()}
${orderBy()}
limit ${limit}`;
}

/** 日历：取一个日期区间内的全部任务（起含止不含） */
export function calendarSql(from: string, to: string, limit = DEFAULT_LIMIT): string {
    return `select ${SELECT_COLS}
from blocks b
where ${openTasksWhere()}
  and ${DUE} is not null
  and ${DUE} >= '${from}' and ${DUE} < '${to}'
${orderBy()}
limit ${limit}`;
}

/**
 * 所有用过的清单名（含已完成任务上的）。
 *
 * 看板要用它才能列出「还没有任务的清单」—— 否则用户没法把卡片拖进一个新清单。
 * 只看未完成任务是不够的：一个清单的任务全做完了，列就会消失。
 */
export function listsSql(): string {
    return `select distinct value as name from attributes
where name='custom-list' and value is not null and value != ''
order by value`;
}

/** 组件自己会按天 / 按象限分组的视图 —— 取数时就是「全部未完成」 */
const CLIENT_GROUPED = ["calendar", "matrix", "stats"];

/**
 * 视图 id → SQL。**所有视图都必须在这里有归宿。**
 *
 * 漏一个的代价是真机上的「未知的智能清单」—— 曾经只特判了 board，
 * 日历和四象限直接掉进 listSql 的兜底断言里炸掉。
 */
export function sqlForView(view: string, today: string): string {
    if (view === "board") {
        return boardSql({ today });
    }
    if (CLIENT_GROUPED.includes(view)) {
        return listSql("all", { today });
    }
    return listSql(view, { today });
}
