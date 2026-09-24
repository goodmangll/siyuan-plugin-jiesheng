import { describe, expect, it } from "vitest";
import {
    barLayout, doneTrendSql, fillSeries, listDistSql, priorityDistSql, recentDays,
} from "../../src/views/stats";

const TODAY = "20260925";

describe("S1 近 N 天（含今天，从早到晚）", () => {
    it("14 天，最后一个是今天", () => {
        const days = recentDays(TODAY, 14);
        expect(days).toHaveLength(14);
        expect(days[13]).toBe(TODAY);
    });
    it("第一个是 13 天前", () => {
        expect(recentDays(TODAY, 14)[0]).toBe("20260912");
    });
    it("跨月", () => {
        expect(recentDays("20261002", 3)).toEqual(["20260930", "20261001", "20261002"]);
    });
    it("跨年", () => {
        expect(recentDays("20270102", 3)).toEqual(["20261231", "20270101", "20270102"]);
    });
});

describe("S2 补零：缺失的日子必须补上（图表不能因为「这天没数据」就断掉）", () => {
    it("有数据的日子取真值，没有的补 0", () => {
        const rows = [{ d: "20260924", c: 3 }, { d: "20260925", c: 1 }];
        const s = fillSeries(rows, recentDays(TODAY, 3));
        expect(s).toEqual([
            { day: "20260923", value: 0 },
            { day: "20260924", value: 3 },
            { day: "20260925", value: 1 },
        ]);
    });
    it("完全没数据 → 全 0，长度仍对", () => {
        const s = fillSeries([], recentDays(TODAY, 5));
        expect(s).toHaveLength(5);
        expect(s.every((x) => x.value === 0)).toBe(true);
    });
    it("多余的行被忽略（不在日期轴上）", () => {
        const s = fillSeries([{ d: "20200101", c: 99 }, { d: TODAY, c: 2 }], recentDays(TODAY, 2));
        expect(s.reduce((n, x) => n + x.value, 0)).toBe(2);
    });
    it("日期值可能是 8 位带时刻 → 取前 8 位匹配", () => {
        const s = fillSeries([{ d: "202609251430", c: 4 }], [TODAY]);
        expect(s[0].value).toBe(4);
    });
});

describe("S3 柱状图的几何（纯 SVG，不引图表库）", () => {
    it("全 0 时不除以 0", () => {
        const bars = barLayout([0, 0, 0], 100, 50);
        expect(bars).toHaveLength(3);
        expect(bars.every((b) => Number.isFinite(b.h))).toBe(true);
        expect(bars.every((b) => b.h === 0)).toBe(true);
    });
    it("最大值顶到满高", () => {
        const bars = barLayout([1, 5, 2], 100, 50);
        expect(bars[1].h).toBe(50);
    });
    it("按比例", () => {
        const bars = barLayout([5, 10], 100, 50);
        expect(bars[0].h).toBe(25);
        expect(bars[1].h).toBe(50);
    });
    it("宽度平分且不重叠", () => {
        const bars = barLayout([1, 1, 1, 1], 100, 50);
        expect(bars[0].x).toBe(0);
        expect(bars[1].x).toBe(25);
        expect(bars[3].x + bars[3].w).toBe(100);
    });
    it("空输入 → 空数组", () => {
        expect(barLayout([], 100, 50)).toEqual([]);
    });
});

describe("S4 分布 SQL", () => {
    it("按清单分布：排除子任务，空清单归到「未指定」", () => {
        const s = listDistSql();
        expect(s).toContain("not exists");
        expect(s).toContain("custom-list");
        expect(s).toContain("coalesce");
    });
    it("按优先级分布", () => {
        const s = priorityDistSql();
        expect(s).toContain("custom-pri");
        expect(s).toContain("not exists");
    });
    it("完成趋势：按 custom-done 的日期分组", () => {
        const s = doneTrendSql("20260912", "20260926");
        expect(s).toContain("custom-done");
        expect(s).toContain("substr");
        expect(s).toContain("group by");
    });
});
