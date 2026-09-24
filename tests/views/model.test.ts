import { describe, expect, it } from "vitest";
import {
    formatDue, groupByDay, groupByList, matrixCell, toViewTask, toViewTasks, type TaskRow,
} from "../../src/views/model";

const TODAY = "20260925";

const row = (over: Partial<TaskRow> = {}): TaskRow => ({
    id: "T1",
    markdown: "- [ ] 写周报",
    hpath: "/工作/周报",
    root_id: "DOC1",
    updated: "202609251000",
    pri: "1",
    due: "20260925",
    start: null,
    remind: "202609240900",
    repeat: "FREQ=WEEKLY;BYDAY=FR",
    lst: "工作",
    ...over,
});

describe("M1 标题清洗（列表项的 content 会带上后代文本，不能直接用）", () => {
    it("去掉未完成标记", () => {
        expect(toViewTask(row(), TODAY).title).toBe("写周报");
    });
    it("去掉已完成的 X 标记", () => {
        expect(toViewTask(row({ markdown: "- [X] 写周报" }), TODAY).title).toBe("写周报");
    });
    it("去掉 ial", () => {
        expect(toViewTask(row({ markdown: '- {: id="A" updated="1"}[ ] 写周报' }), TODAY).title).toBe("写周报");
    });
    it("**只取首行** —— 子任务与正文不能混进标题", () => {
        const t = toViewTask(row({ markdown: "- [ ] 写周报\n\n  正文\n  - [ ] 子任务" }), TODAY);
        expect(t.title).toBe("写周报");
    });
    it("markdown 为 null 时不炸", () => {
        expect(toViewTask(row({ markdown: null }), TODAY).title).toBe("");
    });
    it("嵌套缩进的任务也能取到标题", () => {
        expect(toViewTask(row({ markdown: "  - [ ] 子任务" }), TODAY).title).toBe("子任务");
    });
});

describe("M2 日期与状态", () => {
    it("全天 due → day 就是它，且算今天", () => {
        const t = toViewTask(row({ due: "20260925" }), TODAY);
        expect(t.day).toBe("20260925");
        expect(t.isToday).toBe(true);
        expect(t.overdue).toBe(false);
    });
    it("带时刻的 due 也能取出 8 位日", () => {
        expect(toViewTask(row({ due: "202609251430" }), TODAY).day).toBe("20260925");
    });
    it("昨天 → 逾期", () => {
        const t = toViewTask(row({ due: "20260924" }), TODAY);
        expect(t.overdue).toBe(true);
        expect(t.isToday).toBe(false);
    });
    it("今天带时刻（已过点）也算今天，不算逾期", () => {
        const t = toViewTask(row({ due: "202609251430" }), TODAY);
        expect(t.isToday).toBe(true);
        expect(t.overdue).toBe(false);
    });
    it("明天 → 不逾期不是今天", () => {
        const t = toViewTask(row({ due: "20260926" }), TODAY);
        expect(t.overdue).toBe(false);
        expect(t.isToday).toBe(false);
    });
    it("没有 due → day 为 null，两个标志都为 false", () => {
        const t = toViewTask(row({ due: null }), TODAY);
        expect(t.day).toBeNull();
        expect(t.overdue).toBe(false);
        expect(t.isToday).toBe(false);
    });
});

describe("M3 属性映射", () => {
    it("优先级 1/2/3 → high/medium/low，空 → none", () => {
        expect(toViewTask(row({ pri: "1" }), TODAY).priority).toBe("high");
        expect(toViewTask(row({ pri: "2" }), TODAY).priority).toBe("medium");
        expect(toViewTask(row({ pri: "3" }), TODAY).priority).toBe("low");
        expect(toViewTask(row({ pri: null }), TODAY).priority).toBe("none");
        expect(toViewTask(row({ pri: "abc" }), TODAY).priority).toBe("none");
    });
    it("有没有提醒", () => {
        expect(toViewTask(row({ remind: "202609240900" }), TODAY).hasReminder).toBe(true);
        expect(toViewTask(row({ remind: "" }), TODAY).hasReminder).toBe(false);
        expect(toViewTask(row({ remind: null }), TODAY).hasReminder).toBe(false);
    });
    it("有没有重复", () => {
        expect(toViewTask(row({ repeat: "FREQ=DAILY" }), TODAY).repeat).toBe("FREQ=DAILY");
        expect(toViewTask(row({ repeat: "" }), TODAY).repeat).toBeNull();
    });
    it("清单名去空白；没有则空串", () => {
        expect(toViewTask(row({ lst: "  工作 " }), TODAY).list).toBe("工作");
        expect(toViewTask(row({ lst: null }), TODAY).list).toBe("");
    });
    it("保留 root_id 与路径（点卡片要能跳回去）", () => {
        const t = toViewTask(row(), TODAY);
        expect(t.rootId).toBe("DOC1");
        expect(t.path).toBe("/工作/周报");
    });
});

describe("M4 批量映射", () => {
    it("逐行映射，保持顺序", () => {
        const ts = toViewTasks([row({ id: "A" }), row({ id: "B" })], TODAY);
        expect(ts.map((t) => t.id)).toEqual(["A", "B"]);
    });
    it("空数组 / null → 空数组", () => {
        expect(toViewTasks([], TODAY)).toEqual([]);
        expect(toViewTasks(null as never, TODAY)).toEqual([]);
    });
});

describe("M5 按清单分组（看板的列）", () => {
    it("分组并按清单名排序，空清单归到「收件箱」列", () => {
        const ts = toViewTasks([
            row({ id: "A", lst: "工作" }), row({ id: "B", lst: null }),
            row({ id: "C", lst: "生活" }), row({ id: "D", lst: "工作" }),
        ], TODAY);
        const g = groupByList(ts);
        expect(g.map((x) => x.key)).toEqual(["工作", "生活", ""]);
        expect(g[0].tasks.map((t) => t.id)).toEqual(["A", "D"]);
        expect(g[2].title).toBe("收件箱");
    });
    it("空输入 → 空数组", () => {
        expect(groupByList([])).toEqual([]);
    });
});

describe("M6 按日期分组（日历/列表按天分组）", () => {
    it("无 due 的归到 null 键", () => {
        const ts = toViewTasks([row({ id: "A", due: "20260925" }), row({ id: "B", due: null })], TODAY);
        const m = groupByDay(ts);
        expect([...m.keys()]).toEqual(["20260925", null]);
    });
    it("同一天的多条聚合在一起", () => {
        const ts = toViewTasks([row({ id: "A", due: "20260925" }), row({ id: "B", due: "202609251430" })], TODAY);
        expect(groupByDay(ts).get("20260925")?.map((t) => t.id)).toEqual(["A", "B"]);
    });
});

describe("M7 四象限（重要 × 紧急）", () => {
    it("高优先级 + 3 天内 → q1 重要且紧急", () => {
        expect(matrixCell(toViewTask(row({ pri: "1", due: "20260926" }), TODAY), TODAY)).toBe("q1");
    });
    it("高优先级 + 无日期 → q2 重要不紧急", () => {
        expect(matrixCell(toViewTask(row({ pri: "1", due: null }), TODAY), TODAY)).toBe("q2");
    });
    it("无优先级 + 逾期 → q3 紧急不重要", () => {
        expect(matrixCell(toViewTask(row({ pri: null, due: "20260920" }), TODAY), TODAY)).toBe("q3");
    });
    it("无优先级 + 无日期 → q4", () => {
        expect(matrixCell(toViewTask(row({ pri: null, due: null }), TODAY), TODAY)).toBe("q4");
    });
    it("中优先级也算重要", () => {
        expect(matrixCell(toViewTask(row({ pri: "2", due: null }), TODAY), TODAY)).toBe("q2");
    });
    it("低优先级算不重要", () => {
        expect(matrixCell(toViewTask(row({ pri: "3", due: null }), TODAY), TODAY)).toBe("q4");
    });
    it("边界：第 3 天算紧急，第 4 天不算", () => {
        expect(matrixCell(toViewTask(row({ pri: "1", due: "20260928" }), TODAY), TODAY)).toBe("q1");
        expect(matrixCell(toViewTask(row({ pri: "1", due: "20260929" }), TODAY), TODAY)).toBe("q2");
    });
});

describe("M8 截止日的显示（边界最容易错，单测钉住）", () => {
    const at = (due: string | null) => toViewTask(row({ due }), TODAY);
    it("没有截止日 → 空串", () => {
        expect(formatDue(at(null), TODAY)).toBe("");
    });
    it("今天（全天）→ 今天", () => {
        expect(formatDue(at("20260925"), TODAY)).toBe("今天");
    });
    it("今天（有时刻）→ 今天 14:30", () => {
        expect(formatDue(at("202609251430"), TODAY)).toBe("今天 14:30");
    });
    it("明天 → 明天", () => {
        expect(formatDue(at("20260926"), TODAY)).toBe("明天");
    });
    it("昨天 → 昨天", () => {
        expect(formatDue(at("20260924"), TODAY)).toBe("昨天");
    });
    it("更早 → N 天前", () => {
        expect(formatDue(at("20260920"), TODAY)).toBe("5 天前");
    });
    it("今年内的未来日期 → 月-日", () => {
        expect(formatDue(at("20261001"), TODAY)).toBe("10-01");
    });
    it("跨年 → 带年份", () => {
        expect(formatDue(at("20270101"), TODAY)).toBe("2027-01-01");
        expect(formatDue(at("20251231"), TODAY)).toBe("2025-12-31");
    });
    it("未来日期带时刻也显示时刻", () => {
        expect(formatDue(at("202610011430"), TODAY)).toBe("10-01 14:30");
    });
});
