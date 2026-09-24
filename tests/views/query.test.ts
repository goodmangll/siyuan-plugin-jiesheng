import { describe, expect, it } from "vitest";
import {
    attr, boardSql, calendarSql, countSql, doneSql, doneTasksWhere, listSql, listsSql, openTasksWhere,
    SELECT_COLS, smartListIds, sqlForView, tagsSql, TASK_MARK,
} from "../../src/views/query";

const TODAY = "20260925";

describe("Q1 基础谓词：任务 = **被标记为任务的文档**", () => {
    it("只认文档", () => {
        expect(openTasksWhere()).toContain("b.type='d'");
    });
    it("**必须显式标记** —— 文档数以千计，不能全算任务", () => {
        const w = openTasksWhere();
        expect(w).toContain(TASK_MARK);
        expect(w).toContain("a.value='1'");
        expect(w).toContain("exists");
    });
    it("已完成的不在「未完成」里", () => {
        const w = openTasksWhere();
        expect(w).toContain("custom-done");
        expect(w).toMatch(/is null or .* = ''/);
    });
    it("**子任务排除谓词不再需要**（子任务是 - [ ] 块，天然不是 type='d'）", () => {
        expect(openTasksWhere()).not.toContain("not exists");
    });
});

describe("Q2 属性一律走 attributes 子查询（块表上根本没有 due/pri 列）", () => {
    it("任何视图 SQL 都不许出现 b.due / b.pri 这类", () => {
        const all = [
            ...smartListIds().map((id) => listSql(id, { today: TODAY })),
            ...smartListIds().map((id) => countSql(id, { today: TODAY })),
            boardSql({ today: TODAY }),
            calendarSql("20260901", "20261001"),
            doneSql("20260901", "20261001"),
        ];
        for (const sql of all) {
            expect(sql).not.toMatch(/\bb\.(due|pri|start|remind|repeat|list|done|pin)\b/);
        }
    });
    it("attr() 生成的是 attributes 子查询", () => {
        expect(attr("due")).toContain("from attributes");
        expect(attr("due")).toContain("name='custom-due'");
    });
});

describe("Q3 智能清单的日期条件", () => {
    it("今天：前缀匹配 + 含逾期", () => {
        const s = listSql("today", { today: TODAY });
        expect(s).toContain("like '20260925%'");
        expect(s).toMatch(/or .*< '20260925'/);
    });
    it("明天：只匹配明天", () => {
        expect(listSql("tomorrow", { today: TODAY })).toContain("like '20260926%'");
    });
    it("未来 7 天：从明天到第 7 天（含两端）", () => {
        const s = listSql("next7", { today: TODAY });
        expect(s).toContain(">= '20260926'");
        expect(s).toContain("< '20261003'");
    });
    it("收件箱：没有截止日（null 或空串）", () => {
        const s = listSql("inbox", { today: TODAY });
        expect(s).toMatch(/is null or .* = ''/);
    });
    it("全部未完成：不加日期条件", () => {
        const s = listSql("all", { today: TODAY });
        expect(s).not.toContain("like '2026");
    });
    it("所有清单都继承基础谓词", () => {
        for (const id of smartListIds()) {
            expect(listSql(id, { today: TODAY })).toContain(TASK_MARK);
        }
    });
    it("非法 id 抛错，不静默返回全表", () => {
        expect(() => listSql("banana" as never, { today: TODAY })).toThrow();
    });
    it("limit 可控，且有默认值", () => {
        expect(listSql("all", { today: TODAY, limit: 20 })).toContain("limit 20");
        expect(listSql("all", { today: TODAY })).toMatch(/limit \d+/);
    });
});

describe("Q4 计数与列表同源（否则侧边栏数字和列表对不上）", () => {
    it("两者都含相同的基础谓词与日期条件", () => {
        for (const id of smartListIds()) {
            const l = listSql(id, { today: TODAY });
            const c = countSql(id, { today: TODAY });
            expect(c).toContain("count(*)");
            expect(l).toContain(TASK_MARK);
            expect(c).toContain(TASK_MARK);
        }
    });
    it("今天这一条的口径在两边完全一致", () => {
        expect(countSql("today", { today: TODAY })).toContain("like '20260925%'");
        expect(listSql("today", { today: TODAY })).toContain("like '20260925%'");
    });
});

describe("Q5 排序：置顶 → 优先级 → 截止日 → 更新时间", () => {
    it("置顶排在最前，然后才是优先级", () => {
        const sql = listSql("all", { today: TODAY });
        // 只看 ORDER BY 那一段 —— SELECT 里也会出现 custom-pin
        const order = sql.slice(sql.indexOf("order by"));
        const pin = order.indexOf("custom-pin");
        const pri = order.indexOf("custom-pri");
        expect(pin).toBeGreaterThanOrEqual(0);
        expect(pri).toBeGreaterThan(pin);
    });
});

describe("Q6 看板 / 日历 / 已完成", () => {
    it("看板取全部未完成", () => {
        const s = boardSql({ today: TODAY });
        expect(s).toContain(TASK_MARK);
        expect(s).not.toContain("like '2026");
    });
    it("日历按区间取（起含止不含）", () => {
        const s = calendarSql("20260901", "20261001");
        expect(s).toContain(">= '20260901'");
        expect(s).toContain("< '20261001'");
    });
    it("已完成按完成时间倒序", () => {
        const s = doneSql("20260901", "20261001");
        expect(s).toContain("custom-done");
        expect(s).toMatch(/order by[^;]*desc/);
    });
});

describe("Q7 清单名列表（看板列要用）", () => {
    it("只取非空的 custom-list，去重", () => {
        const s = listsSql();
        expect(s).toContain("distinct");
        expect(s).toContain("name='custom-list'");
        expect(s).toContain("value != ''");
    });
});

describe("Q8 视图 → SQL 分发（漏一个就是真机上的「未知的智能清单」）", () => {
    it("5 个智能清单各自能出 SQL", () => {
        for (const id of smartListIds()) {
            expect(sqlForView(id, TODAY)).toContain("from blocks b");
        }
    });
    it("看板走 boardSql", () => {
        expect(sqlForView("board", TODAY)).toContain(TASK_MARK);
    });
    it("日历 / 四象限 / 统计走「全部未完成」", () => {
        for (const v of ["calendar", "matrix", "stats"]) {
            const s = sqlForView(v, TODAY);
            expect(s).toContain("from blocks b");
            expect(s).not.toMatch(/like '20\d{6}%'/);
        }
    });
    it("**每个视图 id 都必须能出 SQL，一个都不许漏**", () => {
        for (const v of ["today", "tomorrow", "next7", "inbox", "all", "board", "calendar", "matrix", "stats"]) {
            expect(() => sqlForView(v, TODAY), `${v} 出不了 SQL`).not.toThrow();
        }
    });
    it("未知视图仍然抛错，不静默返回全表", () => {
        expect(() => sqlForView("banana", TODAY)).toThrow();
    });
});

describe("Q9 已完成清单（没有它就没法在界面上取消完成 —— 真机踩到）", () => {
    it("done 在清单列表里", () => {
        expect(smartListIds()).toContain("done");
    });
    it("已完成谓词：有 done 时间戳，且在近 N 天内", () => {
        const w = doneTasksWhere(TODAY);
        expect(w).toContain("custom-done");
        expect(w).toContain("is not null");
        expect(w).toContain(">= '20260911'"); // 今天 -14 天
    });
    it("已完成也要求任务标记", () => {
        expect(doneTasksWhere(TODAY)).toContain(TASK_MARK);
    });
    it("listSql('done') 用的是已完成谓词，不是未完成谓词", () => {
        const s = listSql("done", { today: TODAY });
        expect(s).toContain("custom-task");
        expect(s).not.toMatch(/custom-done.*is null/);
    });
    it("其它清单不受影响，仍是未完成谓词", () => {
        for (const id of ["today", "tomorrow", "next7", "inbox", "all"] as const) {
            expect(listSql(id, { today: TODAY })).toMatch(/custom-done.*is null/);
        }
    });
    it("计数与列表同源", () => {
        expect(countSql("done", { today: TODAY })).toContain("custom-done");
    });
});

describe("Q10 标签（思源原生 #tag#，存在 spans 表里）", () => {
    it("tagsSql 从 spans 取，按 root_id 归到文档", () => {
        const s = tagsSql();
        expect(s).toContain("spans");
        expect(s).toContain("type='tag'");
        expect(s).toContain("root_id");
    });
    it("SELECT_COLS 里带上了标签子查询（列表行要显示）", () => {
        expect(SELECT_COLS).toContain("spans");
        expect(SELECT_COLS).toContain("as tags");
    });
    it("标签子查询不会拖垮主查询（是用 group_concat 聚合成一个字符串）", () => {
        expect(SELECT_COLS).toMatch(/group_concat/i);
    });
});
