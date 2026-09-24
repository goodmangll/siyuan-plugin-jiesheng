import { describe, expect, it } from "vitest";
import { ATTR, mergeAttrs, readAttr, toMeta } from "../../src/model/attrs";

describe("A1/A2 属性宿主合并", () => {
    it("列表项块与内层段落块都有 → 取列表项块的", () => {
        const m = mergeAttrs({ [ATTR.pri]: "1" }, { [ATTR.pri]: "3" });
        expect(m[ATTR.pri]).toBe("1");
    });
    it("只有内层段落块有 → 也能读到（兼容 markdown 手写 ial 的模板）", () => {
        const m = mergeAttrs({}, { [ATTR.pri]: "3", [ATTR.due]: "20260925" });
        expect(m[ATTR.pri]).toBe("3");
        expect(m[ATTR.due]).toBe("20260925");
    });
    it("互补时两边都取到", () => {
        const m = mergeAttrs({ [ATTR.due]: "20260925" }, { [ATTR.pri]: "1" });
        expect(m[ATTR.due]).toBe("20260925");
        expect(m[ATTR.pri]).toBe("1");
    });
    it("列表项块显式空串视为「已删除」，不回落", () => {
        const m = mergeAttrs({ [ATTR.pri]: "" }, { [ATTR.pri]: "3" });
        expect(m[ATTR.pri]).toBe("");
        expect(readAttr(m, ATTR.pri)).toBeUndefined();
    });
});

describe("A3 缺值", () => {
    it("两者都没有 → 不抛异常", () => {
        expect(() => mergeAttrs(undefined, undefined)).not.toThrow();
        expect(mergeAttrs(null, null)).toEqual({});
    });
    it("空属性 map → TaskMeta 全为空", () => {
        const meta = toMeta({});
        expect(meta.due).toBeUndefined();
        expect(meta.pri).toBe("none");
        expect(meta.remind).toEqual([]);
        expect(meta.repeat).toBeNull();
        expect(meta.abandoned).toBe(false);
    });
});

describe("A4 完整映射", () => {
    const attrs = {
        [ATTR.due]: "202609251430",
        [ATTR.start]: "202609250900",
        [ATTR.pri]: "1",
        [ATTR.remind]: "202609230900 202609240900",
        [ATTR.repeat]: "FREQ=WEEKLY;BYDAY=FR",
        [ATTR.list]: "工作",
        [ATTR.done]: "202609251500",
        [ATTR.abandoned]: "1",
        [ATTR.spent]: "3",
    };
    it("字段逐个对得上", () => {
        const m = toMeta(attrs);
        expect(m.due).toBe("202609251430");
        expect(m.start).toBe("202609250900");
        expect(m.pri).toBe("high");
        expect(m.remind).toEqual(["202609230900", "202609240900"]);
        expect(m.repeat?.freq).toBe("WEEKLY");
        expect(m.repeat?.byDay).toEqual(["FR"]);
        expect(m.list).toBe("工作");
        expect(m.done).toBe("202609251500");
        expect(m.abandoned).toBe(true);
        expect(m.spent).toBe(3);
    });
    it("非法日期被当作没有，而不是原样透出", () => {
        const m = toMeta({ [ATTR.due]: "abc" });
        expect(m.due).toBeUndefined();
    });
    it("非法重复被当作没有", () => {
        const m = toMeta({ [ATTR.repeat]: "FREQ=LUNAR" });
        expect(m.repeat).toBeNull();
    });
    it("非法工时数被忽略", () => {
        expect(toMeta({ [ATTR.spent]: "abc" }).spent).toBeUndefined();
    });
});
