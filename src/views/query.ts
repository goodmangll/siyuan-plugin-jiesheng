/**
 * 视图层的 SQL 构建 —— **纯函数，全部可单测**。
 *
 * ★ 模型：**任务 = 文档**（`type='d'`），子任务 = 文档正文里的 `- [ ]` 块。
 *
 * ⚠️ **不能把所有 `type='d'` 都当任务**：笔记库里文档数以千计
 *    （真正是任务的只是少数）。
 *    全算任务的话视图会被淹掉。所以任务文档必须**显式标记**：`custom-task="1"`。
 *
 * ⚠️ **属性不在 blocks 表上，在 attributes 表里。** 任何地方写 `b.due` / `b.pri`
 *    都会得到 `no such column: b.due` —— 真机踩过。WHERE / ORDER BY 一律用子查询。
 */

import { addDays, parseDate, toDateStr } from "../model/date";

/** 属性子查询。`b` 是外层 blocks 的别名。 */
export const attr = (name: string): string =>
    `(select value from attributes where block_id=b.id and name='custom-${name}')`;

/**
 * 标签子查询。
 *
 * 思源原生的 `#tag#` **不在 blocks 表里** —— 它存在 `spans` 表（`type='tag'`），
 * 按 `root_id` 归到所属文档（真机确认）。
 * 用 group_concat 聚成一个逗号串，避免给主查询带来行数放大。
 */
export const TAGS_SUB = `(select group_concat(s.content, ',') from spans s
        where s.type='tag' and s.root_id=b.id)`;

/** 所有标签（面板/筛选用） */
export function tagsSql(): string {
    return `select distinct s.content as name, s.root_id as docId
from spans s
where s.type='tag'
order by s.content`;
}

/** 统一取的列。文档的标题在 **content** 里（文档块的 markdown 是空的，真机实测）。 */
export const SELECT_COLS = `b.id, b.content as title, b.hpath, b.box, b.updated,
       ${attr("pri")} as pri, ${attr("due")} as due, ${attr("start")} as start,
       ${attr("remind")} as remind, ${attr("repeat")} as repeat,
       ${attr("list")} as lst, ${attr("done")} as done, ${attr("pin")} as pin,
       ${TAGS_SUB} as tags`;

/** 标记属性：文档带了这个才算任务 */
export const TASK_MARK = "custom-task";

/**
 * 基础谓词：**被标记为任务的、未完成的文档**。
 *
 * 子任务排除谓词在这里**不需要了** —— 子任务是 `- [ ]` 块（`i/t`），
 * 天然不在 `type='d'` 里。这是文档模型带来的一个白赚的简化。
 */
export function openTasksWhere(): string {
    return [
        "b.type='d'",
        `exists (select 1 from attributes a where a.block_id=b.id and a.name='${TASK_MARK}' and a.value='1')`,
        `(${attr("done")} is null or ${attr("done")} = '')`,
    ].join(" and ");
}

export type SmartListId = "today" | "tomorrow" | "next7" | "inbox" | "all" | "done";

export function smartListIds(): SmartListId[] {
    return ["today", "tomorrow", "next7", "inbox", "all", "done"];
}

/** 「已完成」看最近多少天 */
export const DONE_WINDOW_DAYS = 14;

export interface SqlOptions {
    /** 今天，`yyyyMMdd`。日期比较全靠字符串前缀。 */
    today: string;
    limit?: number;
}

const DEFAULT_LIMIT = 500;

function plusDays(day: string, n: number): string {
    const d = parseDate(day);
    return d ? toDateStr(addDays(d, n)) : day;
}

const DUE = attr("due");

/** 智能清单的日期条件。字符串比较即时间比较（due 是 yyyyMMdd / yyyyMMddHHmm）。 */
function smartDateWhere(id: SmartListId, today: string): string {
    switch (id) {
        case "today":
            // 同类产品的「今天」= 今天到期 **加上** 已逾期未完成
            return `(${DUE} like '${today}%' or ${DUE} < '${today}')`;
        case "tomorrow":
            return `${DUE} like '${plusDays(today, 1)}%'`;
        case "next7":
            return `(${DUE} >= '${plusDays(today, 1)}' and ${DUE} < '${plusDays(today, 8)}')`;
        case "inbox":
            return `(${DUE} is null or ${DUE} = '')`;
        case "all":
            return "1=1";
        case "done":
            // 「已完成」不跟 openTasksWhere 走，见 doneTasksWhere
            return "1=1";
        default: {
            const never: never = id;
            throw new Error(`未知的智能清单：${String(never)}`);
        }
    }
}

/** 排序：置顶 → 优先级 → 截止日 → 更新时间 */
function orderBy(): string {
    return `order by (${attr("pin")} is null or ${attr("pin")} = '') asc,
       (${attr("pri")} is null) asc, ${attr("pri")} asc, ${DUE} asc, b.updated desc`;
}

/**
 * 基础谓词：**已完成**的任务文档。
 *
 * 为什么必须单独有一条：任务勾完就从所有「未完成」列表里消失了，
 * 要是没有这个视图，**在界面上就没法把完成改回未完成**（真机踩到）。
 */
export function doneTasksWhere(today: string, days = DONE_WINDOW_DAYS): string {
    const D = attr("done");
    return [
        "b.type='d'",
        `exists (select 1 from attributes a where a.block_id=b.id and a.name='${TASK_MARK}' and a.value='1')`,
        `${D} is not null and ${D} != ''`,
        `${D} >= '${plusDays(today, -days)}'`,
    ].join(" and ");
}

/**
 * 这条任务现在属于哪些智能清单。
 *
 * ⚠️ 和上面那组 SQL 谓词（`smartDateWhere` / `doneTasksWhere`）是**同一个定义的第二处实现**，
 *    两者必须一致。放在同一个文件里紧挨着，就是为了改一边时能看见另一边。
 *    它存在的唯一原因：思源写完属性要 **约 1.3 秒** SQL 才看得到（真机实测），
 *    勾选完成后要立刻把侧栏数字改了，不能等那 1.3 秒。
 *
 * 注意 today 与 next7 的重叠不是笔误：`smartDateWhere` 里「明天」是
 * `like 'day+1%'`、「未来 7 天」是 `>= day+1 and < day+8`，所以**明天到期的两条都进**。
 */
export function smartListsOf(
    t: { done: string | null; due: string | null },
    today: string,
): SmartListId[] {
    if (t.done) {
        // 「已完成」只看最近 DONE_WINDOW_DAYS 天
        return t.done.slice(0, 8) >= plusDays(today, -DONE_WINDOW_DAYS) ? ["done"] : [];
    }
    const due = t.due ?? "";
    const out: SmartListId[] = ["all"];
    if (!due) {
        out.push("inbox");
        return out;
    }
    // 「今天」= 今天到期 **加上** 已逾期未完成（和 SQL 一致）
    if (due.startsWith(today) || due < today) {
        out.push("today");
    }
    const d1 = plusDays(today, 1);
    if (due.startsWith(d1)) {
        out.push("tomorrow");
    }
    if (due >= d1 && due < plusDays(today, 8)) {
        out.push("next7");
    }
    return out;
}

/** 是不是智能清单（只有它们有日期/完成归属这一说） */
export function isSmartListId(id: string): id is SmartListId {
    return (smartListIds() as string[]).includes(id);
}

/** 某个清单的完整 WHERE */
function whereFor(id: SmartListId, today: string): string {
    return id === "done"
        ? doneTasksWhere(today)
        : `${openTasksWhere()} and ${smartDateWhere(id, today)}`;
}

function assertId(id: string): SmartListId {
    if (!smartListIds().includes(id as SmartListId)) {
        throw new Error(`未知的智能清单：${id}`);
    }
    return id as SmartListId;
}

export function listSql(id: string, opts: SqlOptions): string {
    const list = assertId(id);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return `select ${SELECT_COLS}
from blocks b
where ${whereFor(list, opts.today)}
${orderBy()}
limit ${limit}`;
}

/** 计数。**条件与 listSql 同源**，否则侧边栏数字和列表会对不上。 */
export function countSql(id: string, opts: SqlOptions): string {
    const list = assertId(id);
    return `select count(*) as c
from blocks b
where ${whereFor(list, opts.today)}`;
}

/**
 * 6 个侧栏数字**一条 SQL** 拿全。
 *
 * 原来是 6 次并发的 `/api/query/sql` —— 加上列表与笔记本表，一次重载要 8 个 IPC。
 * 改成 6 个标量子查询之后只剩 1 个来回。条件复用同一个 `whereFor`，
 * 所以不会和 `countSql` 漂移。
 */
export function countsSql(opts: SqlOptions): string {
    // ★ 别名必须加引号：`all` 是 SQL 保留字，`as all` 直接语法错。
    //   字符串断言测试抓不住这个 —— 只有打到内核跑一遍才会炸（真机踩到）。
    const parts = smartListIds().map(
        (id) => `(select count(*) from blocks b where ${whereFor(id, opts.today)}) as "${id}"`,
    );
    return `select ${parts.join(", ")}`;
}

/** 看板：按清单分组（清单在映射层从笔记本名或 custom-list 得出） */
export function boardSql(opts: SqlOptions): string {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return `select ${SELECT_COLS}
from blocks b
where ${openTasksWhere()}
${orderBy()}
limit ${limit}`;
}

/** 日历：取一个日期区间内的任务（起含止不含） */
export function calendarSql(from: string, to: string, limit = DEFAULT_LIMIT): string {
    return `select ${SELECT_COLS}
from blocks b
where ${openTasksWhere()}
  and ${DUE} is not null and ${DUE} != ''
  and ${DUE} >= '${from}' and ${DUE} < '${to}'
${orderBy()}
limit ${limit}`;
}

/** 已完成的（近 N 天，按完成时间倒序） */
export function doneSql(from: string, to: string, limit = DEFAULT_LIMIT): string {
    return `select ${SELECT_COLS}
from blocks b
where b.type='d'
  and exists (select 1 from attributes a where a.block_id=b.id and a.name='${TASK_MARK}' and a.value='1')
  and ${attr("done")} >= '${from}' and ${attr("done")} < '${to}'
order by ${attr("done")} desc
limit ${limit}`;
}

/** 所有用过的清单名（看板列要用：没任务的清单也得能出现，否则拖不进去） */
export function listsSql(): string {
    return `select distinct value as name from attributes
where name='custom-list' and value is not null and value != ''
order by value`;
}

/** 组件自己会按天 / 按象限 / 按分组算的视图 —— 取数时就是「全部未完成」 */
const CLIENT_GROUPED = ["calendar", "matrix", "stats"];

/**
 * 视图 id → SQL。**所有视图都必须在这里有归宿。**
 * 漏一个的代价是真机上的「未知的智能清单」。
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

/**
 * 提醒候选：**未完成、有 custom-remind 的任务文档**。
 *
 * 前端（弹通知）和内核（发 webhook）**共用这一条** ——
 * 两套 SQL 迟早会漂移，出现"界面上弹了但 webhook 没发"这种诡异现象。
 */
export function remindCandidatesSql(): string {
    return `select b.id, b.content as title,
       ${attr("remind")} as remind,
       ${attr("due")} as due,
       ${attr("pri")} as pri,
       ${attr("list")} as lst
from blocks b
where b.type='d'
  and exists (select 1 from attributes a where a.block_id=b.id and a.name='${TASK_MARK}' and a.value='1')
  and (${attr("done")} is null or ${attr("done")} = '')
  and (${attr("abandoned")} is null or ${attr("abandoned")} != '1')
  and ${attr("remind")} is not null and ${attr("remind")} != ''
limit 2000`;
}
