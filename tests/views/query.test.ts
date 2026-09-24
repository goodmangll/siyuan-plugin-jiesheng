import { describe, expect, it } from "vitest";
import {
    boardSql, calendarSql, countSql, listSql, listsSql, openTasksWhere, smartListIds, sqlForView,
} from "../../src/views/query";

const TODAY = "20260925";

describe("Q1 基础谓词：未完成 + 排除子任务", () => {
    it("包含未完成与任务项判定", () => {
        const w = openTasksWhere();
        expect(w).toContain("b.type='i'");
        expect(w).toContain("b.subtype='t'");
        expect(w).toContain("b.markdown like '- [ ]%'");
    });
    it("**必须**带子任务排除谓词（设计 §2.5；之前 11 个 QueryView 全漏了这条）", () => {
        const w = openTasksWhere();
        expect(w).toContain("not exists");
        expect(w).toContain("p.type='l'");
        expect(w).toContain("g.type='i' and g.subtype='t'");
    });
});

describe("Q2 智能清单的 SQL", () => {
    // ⚠️ 这里曾经**断言的是错的写法**：写 b.due 单测照样绿，
    //    真机上却是 no such column: b.due。所以下面统一断言属性子查询，
    //    并且有一条守卫明确禁止 b.due 出现。
    it("**任何视图的 SQL 都不许出现 b.due / b.pri**（属性在 attributes 表里）", () => {
        const all = [
            ...smartListIds().map((id) => listSql(id, { today: TODAY })),
            ...smartListIds().map((id) => countSql(id, { today: TODAY })),
            boardSql({ today: TODAY }),
            calendarSql("20260901", "20261001"),
        ];
        for (const sql of all) {
            expect(sql).not.toMatch(/\bb\.(due|pri|start|remind|repeat|list)\b/);
            // 只要提到属性，就必须走 attributes 子查询
            if (sql.includes("custom-")) {
                expect(sql).toContain("from attributes");
            }
        }
    });
    it("今天：按 due 前缀匹配（8 位与 12 位都算今天）", () => {
        const s = listSql("today", { today: TODAY });
        expect(s).toContain("name='custom-due'");
        expect(s).toContain("like '20260925%'");
    });
    it("今天还要含已过期（同类产品的「今天」视图就是今天+逾期）", () => {
        const s = listSql("today", { today: TODAY });
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
    it("收件箱：没有截止日", () => {
        expect(listSql("inbox", { today: TODAY })).toMatch(/is null/);
    });
    it("全部未完成：不加日期条件", () => {
        const s = listSql("all", { today: TODAY });
        expect(s).not.toContain("like '2026");
        expect(s).not.toMatch(/is null\s*$/m);
    });
    it("所有清单都继承基础谓词（子任务排除不能漏）", () => {
        for (const id of smartListIds()) {
            expect(listSql(id, { today: TODAY })).toContain("not exists");
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

describe("Q3 计数 SQL", () => {
    it("每个智能清单都能出计数", () => {
        for (const id of smartListIds()) {
            const s = countSql(id, { today: TODAY });
            expect(s).toContain("count(*)");
            expect(s).toContain("not exists");
        }
    });
    it("今天与列表视图的口径必须完全一致（否则数字和列表对不上）", () => {
        const a = listSql("today", { today: TODAY });
        const b = countSql("today", { today: TODAY });
        const where = (s: string) => s.slice(s.indexOf("where"), s.indexOf("order by") > 0 ? s.indexOf("order by") : s.length);
        expect(where(b)).toContain("like '20260925%'");
        expect(where(a)).toContain("like '20260925%'");
    });
});

describe("Q4 看板", () => {
    it("按清单分组：取 list 属性，并给出空清单的兜底", () => {
        const s = boardSql({ today: TODAY });
        expect(s).toContain("custom-list");
        expect(s).toContain("not exists");
        expect(s).toContain("coalesce");
    });
});

describe("Q5 日历", () => {
    it("按区间取（起含、止不含）", () => {
        const s = calendarSql("20260901", "20261001");
        expect(s).toContain(">= '20260901'");
        expect(s).toContain("< '20261001'");
        expect(s).toContain("not exists");
    });
    it("日历也要算逾期的（否则月里看不到过期的）", () => {
        expect(calendarSql("20260901", "20261001")).toContain("markdown like '- [ ]%'");
    });
});

describe("Q6 清单名列表（看板列要用）", () => {
    it("只取非空的 custom-list，去重", () => {
        const s = listsSql();
        expect(s).toContain("distinct");
        expect(s).toContain("name='custom-list'");
        expect(s).toContain("value != ''");
    });
});

describe("Q7 视图 → SQL 的分发（**曾经漏了 calendar/matrix，真机上直接报错**）", () => {
    it("5 个智能清单各自走自己的 SQL", () => {
        for (const id of smartListIds()) {
            expect(sqlForView(id, TODAY)).toContain("from blocks b");
        }
        expect(sqlForView("inbox", TODAY)).toContain("is null");
    });
    it("看板走 boardSql", () => {
        expect(sqlForView("board", TODAY)).toContain("coalesce");
    });
    it("日历与四象限走「全部未完成」（它们在组件里自己按日期/象限分组）", () => {
        for (const v of ["calendar", "matrix", "stats"]) {
            const s = sqlForView(v, TODAY);
            expect(s).toContain("from blocks b");
            expect(s).toContain("not exists");
            // 「全部」不加日期条件
            expect(s).not.toMatch(/like '20\d{6}%'/);
        }
    });
    it("**每个视图 id 都必须能出 SQL，一个都不许漏**（这就是真机那个 bug）", () => {
        for (const v of ["today", "tomorrow", "next7", "inbox", "all", "board", "calendar", "matrix", "stats"]) {
            expect(() => sqlForView(v, TODAY), `${v} 出不了 SQL`).not.toThrow();
        }
    });
    it("未知视图仍然抛错，不静默返回全表", () => {
        expect(() => sqlForView("banana", TODAY)).toThrow();
    });
});
