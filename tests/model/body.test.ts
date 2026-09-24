import { describe, expect, it } from "vitest";
import { bodyBlocks, bodySummary, type ChildBlock } from "../../src/model/body";

const c = (id: string, type: string, text: string, subtype = ""): ChildBlock =>
    ({ id, type, subtype, text });

describe("B1 哪些子块算「正文」", () => {
    it("只取段落", () => {
        const got = bodyBlocks([
            c("T", "p", "任务标题"),
            c("P1", "p", "正文一"),
            c("L", "l", "- [ ] 子任务", "t"),
        ], "T");
        expect(got.map((b) => b.id)).toEqual(["P1"]);
    });
    it("**排除标题段落**（列表项内层的那个段落装的是标题，不是正文）", () => {
        const got = bodyBlocks([c("T", "p", "任务标题"), c("P1", "p", "正文")], "T");
        expect(got.some((b) => b.id === "T")).toBe(false);
    });
    it("空白段落被丢掉（思源会留空 p）", () => {
        const got = bodyBlocks([c("P1", "p", "  "), c("P2", "p", "\n"), c("P3", "p", "有内容")], "T");
        expect(got.map((b) => b.id)).toEqual(["P3"]);
    });
    it("其它类型暂不算正文 —— 它们不能在纯文本框里编辑，硬编辑会压平丢掉结构", () => {
        const got = bodyBlocks([
            c("C", "c", "代码块"), c("H", "h", "小标题", "h2"), c("M", "m", "公式"),
            c("T2", "t", "表格", "t"), c("P", "p", "真正文"),
        ], "T");
        expect(got.map((b) => b.id)).toEqual(["P"]);
    });
    it("图片段落文本为空 → 被空白过滤掉（图片是 <p><img></p>，但不是可编辑正文）", () => {
        expect(bodyBlocks([c("IMG", "p", ""), c("P", "p", "正文")], "T").map((b) => b.id)).toEqual(["P"]);
    });
    it("没有标题段落 id 时也不崩（标题可能不在子块里）", () => {
        expect(bodyBlocks([c("P1", "p", "正文")], null).map((b) => b.id)).toEqual(["P1"]);
    });
    it("空输入 → 空数组", () => {
        expect(bodyBlocks([], "T")).toEqual([]);
        expect(bodyBlocks(null as never, "T")).toEqual([]);
    });
});

describe("B2 正文摘要（列表行上显示用）", () => {
    it("取第一段的开头，去掉换行", () => {
        expect(bodySummary([{ id: "A", text: "第一段\n换行了" }])).toBe("第一段 换行了");
    });
    it("过长截断并加省略号", () => {
        const long = "啊".repeat(100);
        const got = bodySummary([{ id: "A", text: long }], 20);
        expect(got.length).toBe(21);
        expect(got.endsWith("…")).toBe(true);
    });
    it("没有正文 → 空串", () => {
        expect(bodySummary([])).toBe("");
        expect(bodySummary(null as never)).toBe("");
    });
});
