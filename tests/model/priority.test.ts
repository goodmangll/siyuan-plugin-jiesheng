import { describe, expect, it } from "vitest";
import { PRIORITY, parsePriority, priorityAttr, prioritySortKey } from "../../src/model/priority";

describe("P1/P2 解析", () => {
    it("'1'/'2'/'3' → 高 / 中 / 低", () => {
        expect(parsePriority("1")).toBe("high");
        expect(parsePriority("2")).toBe("medium");
        expect(parsePriority("3")).toBe("low");
    });
    it("空值 / '0' / 非法 → 无", () => {
        expect(parsePriority(undefined)).toBe("none");
        expect(parsePriority(null)).toBe("none");
        expect(parsePriority("")).toBe("none");
        expect(parsePriority("0")).toBe("none");
        expect(parsePriority("abc")).toBe("none");
        expect(parsePriority("4")).toBe("none");
    });
});

describe("P3 序列化", () => {
    it("高/中/低 → '1'/'2'/'3'", () => {
        expect(priorityAttr("high")).toBe("1");
        expect(priorityAttr("medium")).toBe("2");
        expect(priorityAttr("low")).toBe("3");
    });
    it("无 → null（表示「删除属性」而不是写空串）", () => {
        expect(priorityAttr("none")).toBeNull();
    });
});

describe("P4 排序键", () => {
    it("高 < 中 < 低 < 无", () => {
        const keys = [PRIORITY.high, PRIORITY.medium, PRIORITY.low, PRIORITY.none].map(prioritySortKey);
        expect(keys).toEqual([...keys].sort((a, b) => a - b));
    });
});

describe("往返一致", () => {
    it("每一档都能往返", () => {
        for (const lv of ["high", "medium", "low"] as const) {
            expect(parsePriority(priorityAttr(lv))).toBe(lv);
        }
        expect(parsePriority(priorityAttr("none"))).toBe("none");
    });
});
