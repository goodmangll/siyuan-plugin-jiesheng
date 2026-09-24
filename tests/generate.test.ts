import { describe, expect, it } from "vitest";
import { composeBody, generateNextRepeat, type GenerateDeps } from "../src/generate";
import { ATTR } from "../src/model/attrs";

const NOW = new Date(2026, 8, 25, 18, 0); // 2026-09-25 周五

function makeDeps(attrs: Record<string, string>, over: Partial<GenerateDeps> = {}) {
    const created: { notebook: string; title: string; markdown: string }[] = [];
    const written: { id: string; patch: Record<string, string> }[] = [];
    const toasts: string[] = [];
    const deps: GenerateDeps = {
        now: () => NOW,
        readAttrs: async () => attrs,
        readTitle: async () => "写周报",
        exportBody: async () => "---\ntitle: 写周报\n---\n\n# 写周报\n\n正文内容\n",
        notebookOf: async () => "NB1",
        createDoc: async (notebook, title, markdown) => {
            created.push({ notebook, title, markdown });
            return "NEW1";
        },
        writeAttrs: async (id, patch) => { written.push({ id, patch }); },
        toast: (m) => toasts.push(m),
        ...over,
    };
    return { deps, created, written, toasts };
}

const base = {
    [ATTR.task]: "1",
    [ATTR.due]: "20260925",
    [ATTR.repeat]: "FREQ=DAILY",
    [ATTR.remind]: "202609230900",
    [ATTR.list]: "工作",
    [ATTR.pri]: "1",
};

describe("G1 正文合成（★ 任务=文档）", () => {
    it("**不写 # 标题** —— 标题由路径给出，写了会变成正文里的第一个块", () => {
        expect(composeBody("写周报", "正文内容")).toBe("正文内容\n");
    });
    it("导出正文里的 frontmatter 与自动加的标题都被清掉", () => {
        const raw = "---\ntitle: 写周报\n---\n\n# 写周报\n\n真正的正文\n";
        expect(composeBody("写周报", raw)).toBe("真正的正文\n");
    });
    it("没有正文 → 空串（不硬塞一个标题）", () => {
        expect(composeBody("写周报", "")).toBe("");
    });
});

describe("G2 不生成的情况", () => {
    it("没有 repeat → 不生成", async () => {
        const { deps, created } = makeDeps({ [ATTR.due]: "20260925" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(created).toHaveLength(0);
    });
    it("COUNT 用尽 → 不生成，给出提示", async () => {
        const { deps, created, toasts } = makeDeps({ [ATTR.due]: "20260925", [ATTR.repeat]: "FREQ=DAILY;COUNT=0" });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(created).toHaveLength(0);
        expect(toasts[0]).toContain("重复已结束");
    });
    it("找不到笔记本 → 不生成，明确报错（不静默丢到别处）", async () => {
        const { deps, created, toasts } = makeDeps(base, { notebookOf: async () => null });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(created).toHaveLength(0);
        expect(toasts[0]).toContain("找不到任务所在笔记本");
    });
    it("建文档失败 → 提示，不写属性", async () => {
        const { deps, written, toasts } = makeDeps(base, { createDoc: async () => null });
        expect(await generateNextRepeat("T", deps)).toBeNull();
        expect(written).toHaveLength(0);
        expect(toasts[0]).toContain("生成失败");
    });
});

describe("G3 正常生成", () => {
    it("在同一个笔记本里建新文档，标题相同", async () => {
        const { deps, created } = makeDeps(base);
        await generateNextRepeat("T", deps);
        expect(created).toHaveLength(1);
        expect(created[0].notebook).toBe("NB1");
        expect(created[0].title).toBe("写周报");
        expect(created[0].markdown).toContain("正文内容");
        // 不能再出现 # 标题
        expect(created[0].markdown).not.toContain("# 写周报");
    });
    it("**frontmatter 不能带过去**", async () => {
        const { deps, created } = makeDeps(base);
        await generateNextRepeat("T", deps);
        expect(created[0].markdown).not.toContain("title: 写周报");
        expect(created[0].markdown).not.toContain("---");
    });
    it("新文档被打上任务标记，并重算 due/remind/repeat/list/pri", async () => {
        const { deps, written } = makeDeps(base);
        await generateNextRepeat("T", deps);
        expect(written).toHaveLength(1);
        const p = written[0].patch;
        expect(p[ATTR.task]).toBe("1");
        expect(p[ATTR.due]).toBe("20260926");
        expect(p[ATTR.remind]).toBe("202609240900");
        expect(p[ATTR.repeat]).toBe("FREQ=DAILY");
        expect(p[ATTR.list]).toBe("工作");
        expect(p[ATTR.pri]).toBe("1");
    });
    it("不继承完成态 / 放弃 / 工时", async () => {
        const { deps, written } = makeDeps({
            ...base, [ATTR.done]: "202609251800", [ATTR.abandoned]: "1", [ATTR.spent]: "3",
        });
        await generateNextRepeat("T", deps);
        const p = written[0].patch;
        expect(p).not.toHaveProperty(ATTR.done);
        expect(p).not.toHaveProperty(ATTR.abandoned);
        expect(p).not.toHaveProperty(ATTR.spent);
    });
    it("没有 list/pri 时不写多余的键", async () => {
        const { deps, written } = makeDeps({ [ATTR.due]: "20260925", [ATTR.repeat]: "FREQ=DAILY" });
        await generateNextRepeat("T", deps);
        const p = written[0].patch;
        expect(p).not.toHaveProperty(ATTR.list);
        expect(p).not.toHaveProperty(ATTR.pri);
    });
});

describe("G4 repeatFrom=done", () => {
    it("从完成日递推，不是从截止日", async () => {
        const { deps, written } = makeDeps({
            [ATTR.due]: "20260901", [ATTR.repeat]: "FREQ=DAILY", [ATTR.repeatFrom]: "done",
        });
        await generateNextRepeat("T", deps);
        expect(written[0].patch[ATTR.due]).toBe("20260926");
    });
});
