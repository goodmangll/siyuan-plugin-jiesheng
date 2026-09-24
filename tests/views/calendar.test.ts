import { describe, expect, it } from "vitest";
import { monthGrid, monthLabel, shiftMonth, weekdayHeaders } from "../../src/views/calendar";

describe("C1 月份网格", () => {
    it("固定 6 行 × 7 列（高度不跳）", () => {
        const g = monthGrid("20260901");
        expect(g).toHaveLength(6);
        for (const row of g) {
            expect(row).toHaveLength(7);
        }
    });
    it("周一开始（国内习惯），表头也是周一起", () => {
        expect(weekdayHeaders()[0]).toBe("一");
        expect(weekdayHeaders()[6]).toBe("日");
    });
    it("2026-09：1 号是周二，所以第一格是 8/31 且不在本月", () => {
        const g = monthGrid("20260901");
        expect(g[0][0].day).toBe("20260831");
        expect(g[0][0].inMonth).toBe(false);
        expect(g[0][1].day).toBe("20260901");
        expect(g[0][1].inMonth).toBe(true);
    });
    it("本月最后一天是 9/30，之后是 10 月且不在本月", () => {
        const g = monthGrid("20260901");
        const flat = g.flat();
        expect(flat.find((c) => c.day === "20260930")!.inMonth).toBe(true);
        expect(flat.find((c) => c.day === "20261001")!.inMonth).toBe(false);
    });
    it("跨年：2026-01 的第一格在上一年", () => {
        const g = monthGrid("20260115");
        expect(g[0][0].day.startsWith("2025")).toBe(true);
    });
    it("闰年 2 月 29 天", () => {
        const flat = monthGrid("20240201").flat();
        expect(flat.find((c) => c.day === "20240229")!.inMonth).toBe(true);
        expect(flat.find((c) => c.day === "20240301")!.inMonth).toBe(false);
    });
    it("非闰年 2 月没有 29 号", () => {
        const flat = monthGrid("20260201").flat();
        expect(flat.some((c) => c.day === "20260229")).toBe(false);
    });
    it("格子日期连续无缺口", () => {
        const flat = monthGrid("20260901").flat();
        for (let i = 1; i < flat.length; i++) {
            const prev = flat[i - 1].day;
            const cur = flat[i].day;
            const d = new Date(Number(prev.slice(0, 4)), Number(prev.slice(4, 6)) - 1, Number(prev.slice(6, 8)) + 1);
            const p = (n: number) => String(n).padStart(2, "0");
            expect(cur).toBe(`${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`);
        }
    });
});

describe("C2 翻月", () => {
    it("往后一个月", () => {
        expect(shiftMonth("20260915", 1)).toBe("20261015");
    });
    it("往前一个月", () => {
        expect(shiftMonth("20260915", -1)).toBe("20260815");
    });
    it("跨年往前", () => {
        expect(shiftMonth("20260115", -1)).toBe("20251215");
    });
    it("跨年往后", () => {
        expect(shiftMonth("20261215", 1)).toBe("20270115");
    });
    it("31 号翻到只有 30 天的月份 → 收敛到当月最后一天，不溢出到次月", () => {
        expect(shiftMonth("20260131", 1)).toBe("20260228");
        expect(shiftMonth("20260331", 1)).toBe("20260430");
    });
});

describe("C3 月份标题", () => {
    it("中文年月", () => {
        expect(monthLabel("20260915")).toBe("2026 年 9 月");
    });
});
