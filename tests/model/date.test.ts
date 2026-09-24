import { describe, expect, it } from "vitest";
import {
    addDays, isAllDay, nextWeekSameDay, parseDate, reshape, toDateStr, toDateTimeStr,
} from "../../src/model/date";

describe("D1/D2 序列化", () => {
    it("Date → yyyyMMdd（8 位）", () => {
        expect(toDateStr(new Date(2026, 8, 25, 14, 30))).toBe("20260925");
    });
    it("Date → yyyyMMddHHmm（12 位）", () => {
        expect(toDateTimeStr(new Date(2026, 8, 25, 14, 30))).toBe("202609251430");
    });
    it("补零", () => {
        expect(toDateStr(new Date(2026, 0, 5))).toBe("20260105");
        expect(toDateTimeStr(new Date(2026, 0, 5, 9, 7))).toBe("202601050907");
    });
});

describe("D3/D4 解析", () => {
    it("'20260925' → 本地当天 00:00", () => {
        expect(parseDate("20260925")).toEqual(new Date(2026, 8, 25, 0, 0));
    });
    it("'202609251430' → 本地当天 14:30", () => {
        expect(parseDate("202609251430")).toEqual(new Date(2026, 8, 25, 14, 30));
    });
});

describe("D5 全天判定", () => {
    it("8 位 = 全天", () => expect(isAllDay("20260925")).toBe(true));
    it("12 位 = 有时刻", () => expect(isAllDay("202609251430")).toBe(false));
});

describe("D6 相对日期", () => {
    it("加天数（跨月）", () => {
        expect(toDateStr(addDays(new Date(2026, 8, 30), 3))).toBe("20261003");
    });
    it("加天数（跨年）", () => {
        expect(toDateStr(addDays(new Date(2026, 11, 31), 1))).toBe("20270101");
    });
    it("下周同一天", () => {
        expect(toDateStr(nextWeekSameDay(new Date(2026, 8, 25, 14, 30)))).toBe("20261002");
    });
    it("保留原形态：全天进全天出，有时刻进有时刻出", () => {
        expect(reshape("20260925", new Date(2026, 9, 1, 9, 0))).toBe("20261001");
        expect(reshape("202609251430", new Date(2026, 9, 1, 9, 0))).toBe("202610010900");
    });
});

describe("D7 非法输入", () => {
    it("空串 / 短串 / 非数字 → null，不抛异常", () => {
        expect(parseDate("")).toBeNull();
        expect(parseDate("2026")).toBeNull();
        expect(parseDate("abcd")).toBeNull();
        expect(parseDate("20261332")).toBeNull(); // 13 月 32 日
        expect(parseDate("20260925143099")).toBeNull(); // 太长
    });
});
