import { describe, expect, it } from "vitest";
import { generateNextRepeat, repeatTaskMarkdown, type GenerateDeps } from "../src/generate";
import { ATTR } from "../src/model/attrs";

const NOW = new Date(2026, 8, 25, 18, 0); // 2026-09-25 周五

function makeDeps(attrs: Record<string, string>, over: Partial<GenerateDeps> = {}) {
    const inserted: { prev: string; md: string }[] = [];
    const written: { id: string; patch: Record<string, string> }[] = [];
    const toasts: string[] = [];
    const deps: GenerateDeps = {
        now: () => NOW,
        readAttrs: async () => attrs,
        readTitle: async () => "写周报",
        insertAfter: async (prev, md) => { inserted.push({ prev, md }); return "NEW1"; },
        writeAttrs: async (id, patch) => { written.push({ id, patch }); },
        toast: (m) => toasts.push(m),
        ...over,
    };
    return { deps, inserted, written, toasts };
}

const base = {
    [ATTR.due]: "20260925",
    [ATTR.repeat]: "FREQ=DAILY",
    [ATTR.remind]: "202609230900",
    [ATTR.list]: "工作",
    [ATTR.pri]: "1",
    [ATTR.start]: "202609201000",
};

describe("G1/G3 不生成的情况", () => {
    it("没有 repeat → 不插入，返回 null", async () => {
        const { deps, inserted } = makeDeps({ [ATTR.due]: "20260925" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(inserted).toHaveLength(0);
    });
    it("非法 repeat → 不插入", async () => {
        const { deps, inserted } = makeDeps({ [ATTR.repeat]: "FREQ=LUNAR" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(inserted).toHaveLength(0);
    });
    it("COUNT 用尽（系列结束）→ 不插入，给出提示", async () => {
        const { deps, inserted, toasts } = makeDeps({ [ATTR.due]: "20260925", [ATTR.repeat]: "FREQ=DAILY;COUNT=0" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(inserted).toHaveLength(0);
        expect(toasts[0]).toContain("重复已结束");
    });
    it("UNTIL 已过 → 不插入", async () => {
        const { deps, inserted } = makeDeps({ [ATTR.due]: "20261001", [ATTR.repeat]: "FREQ=DAILY;UNTIL=20261001" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(inserted).toHaveLength(0);
    });
});

describe("G2/G5 正常生成", () => {
    it("紧跟在原任务后面插入，markdown 是 - [ ] 标题", async () => {
        const { deps, inserted } = makeDeps(base);
        await generateNextRepeat("T", deps);
        expect(inserted).toEqual([{ prev: "T", md: "- [ ] 写周报" }]);
    });
    it("写回新块的属性：due/start/remind/repeat/list/pri 全带", async () => {
        const { deps, written } = makeDeps(base);
        await generateNextRepeat("T", deps);
        expect(written).toHaveLength(1);
        expect(written[0].id).toBe("NEW1");
        const p = written[0].patch;
        expect(p[ATTR.due]).toBe("20260926");
        expect(p[ATTR.start]).toBe("202609211000");
        expect(p[ATTR.remind]).toBe("202609240900");
        expect(p[ATTR.repeat]).toBe("FREQ=DAILY");
        expect(p[ATTR.list]).toBe("工作");
        expect(p[ATTR.pri]).toBe("1");
    });
    it("G6 不继承完成态 / 放弃 / 工时", async () => {
        const { deps, written } = makeDeps({
            ...base, [ATTR.done]: "202609251800", [ATTR.abandoned]: "1", [ATTR.spent]: "3",
        });
        await generateNextRepeat("T", deps);
        const p = written[0].patch;
        expect(p).not.toHaveProperty(ATTR.done);
        expect(p).not.toHaveProperty(ATTR.abandoned);
        expect(p).not.toHaveProperty(ATTR.spent);
    });
    it("G7 没有 list/pri 时不写多余的键", async () => {
        const { deps, written } = makeDeps({ [ATTR.due]: "20260925", [ATTR.repeat]: "FREQ=DAILY" });
        await generateNextRepeat("T", deps);
        const p = written[0].patch;
        expect(p).not.toHaveProperty(ATTR.list);
        expect(p).not.toHaveProperty(ATTR.pri);
        expect(p).not.toHaveProperty(ATTR.start);
        expect(p[ATTR.remind]).toBe(""); // 没有提醒就显式清空（新块本来也没有）
    });
});

describe("G4 插入失败", () => {
    it("拿不到新块 id → 不写属性，给出提示，返回 null", async () => {
        const { deps, written, toasts } = makeDeps(base, { insertAfter: async () => null });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(written).toHaveLength(0);
        expect(toasts[0]).toContain("生成失败");
    });
});

describe("repeatFrom=done 端到端", () => {
    it("从完成日递推，而不是截止日", async () => {
        const { deps, written } = makeDeps({
            [ATTR.due]: "20260925", [ATTR.repeat]: "FREQ=DAILY", [ATTR.repeatFrom]: "done",
        });
        await generateNextRepeat("T", deps);
        expect(written[0].patch[ATTR.due]).toBe("20260926");
        // 若走 due 也是 9/26（两者巧合），所以再验证一个能区分的情形
        const { deps: d2, written: w2 } = makeDeps(
            { [ATTR.due]: "20260901", [ATTR.repeat]: "FREQ=DAILY", [ATTR.repeatFrom]: "done" },
        );
        await generateNextRepeat("T", d2);
        expect(w2[0].patch[ATTR.due]).toBe("20260926"); // 从 9/25 完成日推，不是从 9/1
    });
});

describe("repeatTaskMarkdown", () => {
    it("去掉首尾空白", () => {
        expect(repeatTaskMarkdown("  写周报  ")).toBe("- [ ] 写周报");
    });
    it("空标题不炸", () => {
        expect(repeatTaskMarkdown("")).toBe("- [ ] ");
    });
});
