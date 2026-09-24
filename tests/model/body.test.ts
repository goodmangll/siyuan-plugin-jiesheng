import { describe, expect, it } from "vitest";
import { bodyBlocks, bodySummary, cleanDocBody, stripFrontmatter, type ChildBlock } from "../../src/model/body";

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

describe("B3 剥掉导出正文的 frontmatter（重复任务要复制正文，frontmatter 不能带过去）", () => {
    it("标准 frontmatter 被剥掉", () => {
        const md = "---\ntitle: 甲\ndate: 2026-01-01\n---\n\n# 甲\n\n正文\n";
        expect(stripFrontmatter(md)).toBe("# 甲\n\n正文\n");
    });
    it("没有 frontmatter → 原样", () => {
        expect(stripFrontmatter("# 甲\n\n正文\n")).toBe("# 甲\n\n正文\n");
    });
    it("只有开头 --- 没有结尾 → 原样返回，别把内容吃掉", () => {
        const md = "---\ntitle: 甲\n没结尾\n";
        expect(stripFrontmatter(md)).toBe(md);
    });
    it("空输入 → 空串", () => {
        expect(stripFrontmatter("")).toBe("");
        expect(stripFrontmatter(null as never)).toBe("");
    });
    it("正文里出现 --- 分隔线不会误伤", () => {
        const md = "---\ntitle: 甲\n---\n\n# 甲\n\n---\n\n后面还有内容\n";
        expect(stripFrontmatter(md)).toBe("# 甲\n\n---\n\n后面还有内容\n");
    });
});


describe("B4 cleanDocBody：导出正文里要去掉「自动加的标题 h1」（真机：不然标题重复四遍）", () => {
    it("frontmatter + 自动加的 # 标题 都去掉", () => {
        const md = "---\ntitle: 甲\n---\n\n# 甲\n\n正文\n";
        expect(cleanDocBody(md, "甲")).toBe("正文\n");
    });
    it("标题不匹配时**不动**（别把用户自己的小标题吃掉）", () => {
        const md = "---\ntitle: 甲\n---\n\n# 另一个标题\n\n正文\n";
        expect(cleanDocBody(md, "甲")).toBe("# 另一个标题\n\n正文\n");
    });
    it("没给标题 → 只剥 frontmatter", () => {
        expect(cleanDocBody("---\ntitle: 甲\n---\n\n# 甲\n\n正文\n")).toBe("# 甲\n\n正文\n");
    });
    it("没有标题行也不崩", () => {
        expect(cleanDocBody("---\ntitle: 甲\n---\n\n正文\n", "甲")).toBe("正文\n");
    });
    it("空输入 → 空串", () => {
        expect(cleanDocBody("", "甲")).toBe("");
        expect(cleanDocBody(null as never, "甲")).toBe("");
    });
});
