import { describe, expect, it } from "vitest";
import {
    boardColumns, formatDue, groupByDay, groupByList, groupByPriority, listColumns, matrixCell,
    toViewTask, toViewTasks, type TaskRow,
} from "../../src/views/model";

const TODAY = "20260925";

/** ★ 任务 = 文档：标题在 title（blocks.content），清单默认来自笔记本名 */
const row = (over: Partial<TaskRow> = {}): TaskRow => ({
    id: "DOC1",
    title: "写周报",
    hpath: "/工作/写周报",
    box: "NB1",
    updated: "202609251000",
    pri: "1",
    due: "20260925",
    start: null,
    remind: "202609240900",
    repeat: "FREQ=WEEKLY;BYDAY=FR",
    lst: null,
    done: null,
    pin: null,
    tags: null,
    ...over,
});

const NB = { NB1: "工作", NB2: "生活" };

describe("M1 标题与清单", () => {
    it("标题直接取文档标题", () => {
        expect(toViewTask(row(), TODAY).title).toBe("写周报");
    });
    it("标题首尾空白去掉", () => {
        expect(toViewTask(row({ title: "  写周报  " }), TODAY).title).toBe("写周报");
    });
    it("title 为 null 不炸", () => {
        expect(toViewTask(row({ title: null }), TODAY).title).toBe("");
    });
    it("**清单默认取笔记本名**", () => {
        expect(toViewTask(row(), TODAY, "工作").list).toBe("工作");
    });
    it("custom-list 优先于笔记本名", () => {
        expect(toViewTask(row({ lst: "项目X" }), TODAY, "工作").list).toBe("项目X");
    });
    it("没有笔记本名也没有属性 → 空串", () => {
        expect(toViewTask(row({ lst: null }), TODAY).list).toBe("");
    });
});

describe("M2 完成与置顶", () => {
    it("custom-done 非空 = 已完成", () => {
        expect(toViewTask(row({ done: "202609251430" }), TODAY).done).toBe("202609251430");
    });
    it("custom-done 为空串 = 未完成", () => {
        expect(toViewTask(row({ done: "" }), TODAY).done).toBeNull();
        expect(toViewTask(row({ done: null }), TODAY).done).toBeNull();
    });
    it("custom-pin 非空 = 置顶", () => {
        expect(toViewTask(row({ pin: "1" }), TODAY).pinned).toBe(true);
        expect(toViewTask(row({ pin: "" }), TODAY).pinned).toBe(false);
        expect(toViewTask(row({ pin: null }), TODAY).pinned).toBe(false);
    });
});

describe("M3 日期与状态", () => {
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
    it("没有 due → day 为 null，两个标志都为 false", () => {
        const t = toViewTask(row({ due: null }), TODAY);
        expect(t.day).toBeNull();
        expect(t.overdue).toBe(false);
        expect(t.isToday).toBe(false);
    });
});

describe("M4 属性映射", () => {
    it("优先级 1/2/3 → high/medium/low，空 → none", () => {
        expect(toViewTask(row({ pri: "1" }), TODAY).priority).toBe("high");
        expect(toViewTask(row({ pri: "2" }), TODAY).priority).toBe("medium");
        expect(toViewTask(row({ pri: "3" }), TODAY).priority).toBe("low");
        expect(toViewTask(row({ pri: null }), TODAY).priority).toBe("none");
        expect(toViewTask(row({ pri: "abc" }), TODAY).priority).toBe("none");
    });
    it("有没有提醒 / 重复", () => {
        expect(toViewTask(row({ remind: "202609240900" }), TODAY).hasReminder).toBe(true);
        expect(toViewTask(row({ remind: "" }), TODAY).hasReminder).toBe(false);
        expect(toViewTask(row({ repeat: "FREQ=DAILY" }), TODAY).repeat).toBe("FREQ=DAILY");
        expect(toViewTask(row({ repeat: "" }), TODAY).repeat).toBeNull();
    });
    it("标签：逗号串 → 数组，去空白", () => {
        expect(toViewTask(row({ tags: "工作,紧急" }), TODAY).tags).toEqual(["工作", "紧急"]);
        expect(toViewTask(row({ tags: " 工作 , , 紧急 " }), TODAY).tags).toEqual(["工作", "紧急"]);
        expect(toViewTask(row({ tags: null }), TODAY).tags).toEqual([]);
    });
    it("保留 box 与路径（清单来源 + 跳转）", () => {
        const t = toViewTask(row(), TODAY, "工作");
        expect(t.box).toBe("NB1");
        expect(t.path).toBe("/工作/写周报");
    });
});

describe("M5 批量映射会带上笔记本名", () => {
    it("逐行映射，用 box 查笔记本名当清单", () => {
        const ts = toViewTasks([row({ id: "A", box: "NB1" }), row({ id: "B", box: "NB2" })], TODAY, NB);
        expect(ts.map((t) => t.list)).toEqual(["工作", "生活"]);
    });
    it("没有笔记本表时退回 custom-list / 空串，不崩", () => {
        const ts = toViewTasks([row({ lst: "项目X" })], TODAY);
        expect(ts[0].list).toBe("项目X");
    });
    it("空数组 / null → 空数组", () => {
        expect(toViewTasks([], TODAY)).toEqual([]);
        expect(toViewTasks(null as never, TODAY)).toEqual([]);
    });
});

describe("M6 按清单分组（看板的列）", () => {
    it("分组并按清单名排序，空清单归到「收件箱」列", () => {
        const ts = toViewTasks([
            row({ id: "A", lst: "工作" }), row({ id: "B", lst: null, box: "" }),
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

describe("M7 按日期分组", () => {
    it("无 due 的归到 null 键", () => {
        const ts = toViewTasks([row({ id: "A", due: "20260925" }), row({ id: "B", due: null })], TODAY);
        expect([...groupByDay(ts).keys()]).toEqual(["20260925", null]);
    });
    it("同一天的多条聚合在一起", () => {
        const ts = toViewTasks([row({ id: "A", due: "20260925" }), row({ id: "B", due: "202609251430" })], TODAY);
        expect(groupByDay(ts).get("20260925")?.map((t) => t.id)).toEqual(["A", "B"]);
    });
});

describe("M8 截止日的显示", () => {
    const at = (due: string | null) => toViewTask(row({ due }), TODAY);
    it("没有截止日 → 空串", () => expect(formatDue(at(null), TODAY)).toBe(""));
    it("今天（全天）→ 今天", () => expect(formatDue(at("20260925"), TODAY)).toBe("今天"));
    it("今天（有时刻）→ 今天 14:30", () => expect(formatDue(at("202609251430"), TODAY)).toBe("今天 14:30"));
    it("明天 → 明天", () => expect(formatDue(at("20260926"), TODAY)).toBe("明天"));
    it("昨天 → 昨天", () => expect(formatDue(at("20260924"), TODAY)).toBe("昨天"));
    it("更早 → N 天前", () => expect(formatDue(at("20260920"), TODAY)).toBe("5 天前"));
    it("今年内的未来日期 → 月-日", () => expect(formatDue(at("20261001"), TODAY)).toBe("10-01"));
    it("跨年 → 带年份", () => {
        expect(formatDue(at("20270101"), TODAY)).toBe("2027-01-01");
        expect(formatDue(at("20251231"), TODAY)).toBe("2025-12-31");
    });
    it("未来日期带时刻也显示时刻", () => {
        expect(formatDue(at("202610011430"), TODAY)).toBe("10-01 14:30");
    });
});

describe("M9 按优先级分组", () => {
    const mk = (pri: string | null) => toViewTask(row({ pri, due: null }), TODAY);
    it("固定顺序 高→中→低→无，空列也保留", () => {
        const g = groupByPriority([mk("3"), mk("1")]);
        expect(g.map((x) => x.key)).toEqual(["high", "medium", "low", "none"]);
        expect(g[0].tasks).toHaveLength(1);
        expect(g[1].tasks).toHaveLength(0);
        expect(g[2].tasks).toHaveLength(1);
    });
    it("列标题是中文", () => {
        expect(groupByPriority([]).map((x) => x.title)).toEqual(["高", "中", "低", "无"]);
    });
    it("空输入 → 仍是 4 个空列", () => {
        expect(groupByPriority([])).toHaveLength(4);
    });
});

describe("M10 看板的列：已知清单 ∪ 任务里的清单", () => {
    const mk = (list: string) => toViewTask(row({ lst: list, due: null }), TODAY);
    it("空清单永远在第一列，且标题是「收件箱」", () => {
        const cols = listColumns([mk("工作")], []);
        expect(cols[0].key).toBe("");
        expect(cols[0].title).toBe("收件箱");
    });
    it("已知但没有任务的清单也要出现（否则没法拖进去）", () => {
        const cols = listColumns([], ["工作", "生活"]);
        expect(cols.map((c) => c.key)).toEqual(["", "工作", "生活"]);
        expect(cols[1].tasks).toEqual([]);
    });
    it("空串混进已知清单也不会产生两个收件箱", () => {
        expect(listColumns([], ["", "工作"]).filter((c) => c.key === "")).toHaveLength(1);
    });
    it("boardColumns 按维度分流", () => {
        expect(boardColumns([mk("工作")], [], "list").map((c) => c.key)).toEqual(["", "工作"]);
        expect(boardColumns([], [], "priority")).toHaveLength(4);
    });
});

describe("M11 四象限", () => {
    it("高优先级 + 3 天内 → q1", () => expect(matrixCell(toViewTask(row({ pri: "1", due: "20260926" }), TODAY), TODAY)).toBe("q1"));
    it("高优先级 + 无日期 → q2", () => expect(matrixCell(toViewTask(row({ pri: "1", due: null }), TODAY), TODAY)).toBe("q2"));
    it("无优先级 + 逾期 → q3", () => expect(matrixCell(toViewTask(row({ pri: null, due: "20260920" }), TODAY), TODAY)).toBe("q3"));
    it("无优先级 + 无日期 → q4", () => expect(matrixCell(toViewTask(row({ pri: null, due: null }), TODAY), TODAY)).toBe("q4"));
    it("中优先级也算重要", () => expect(matrixCell(toViewTask(row({ pri: "2", due: null }), TODAY), TODAY)).toBe("q2"));
    it("低优先级算不重要", () => expect(matrixCell(toViewTask(row({ pri: "3", due: null }), TODAY), TODAY)).toBe("q4"));
    it("边界：第 3 天算紧急，第 4 天不算", () => {
        expect(matrixCell(toViewTask(row({ pri: "1", due: "20260928" }), TODAY), TODAY)).toBe("q1");
        expect(matrixCell(toViewTask(row({ pri: "1", due: "20260929" }), TODAY), TODAY)).toBe("q2");
    });
});
