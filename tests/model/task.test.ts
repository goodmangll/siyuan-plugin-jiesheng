import { describe, expect, it } from "vitest";
import { isSubtask, isTaskKramdown, setTaskDone, taskTitleFromKramdown } from "../../src/model/task";

const KR = [
    '- {: id="A" updated="20260925"}[ ] 父任务',
    '  {: id="B" custom-pri="1"}',
    "",
    "  正文第一段。",
    "",
    "  - [ ] 子任务 A",
    "",
    "  > 引述块也要保留",
    "",
    "- [ ] 另一个任务",
].join("\n");

describe("T1/T2 标记切换", () => {
    it("[ ] → [X]，只动首行标记", () => {
        const out = setTaskDone(KR, true)!;
        expect(out.split("\n")[0]).toBe('- {: id="A" updated="20260925"}[X] 父任务');
    });
    it("[X] → [ ]", () => {
        const done = setTaskDone(KR, true)!;
        expect(setTaskDone(done, false)!.split("\n")[0]).toBe('- {: id="A" updated="20260925"}[ ] 父任务');
    });
    it("小写 [x] 也认定为已完成", () => {
        expect(isTaskKramdown("- [x] 标题")).toBe(true);
        expect(isTaskKramdown("- [X] 标题")).toBe(true);
        expect(isTaskKramdown("- [ ] 标题")).toBe(true);
    });
});

describe("T3 不动其它东西", () => {
    const out = setTaskDone(KR, true)!;
    it("ial 原样保留", () => {
        expect(out).toContain('{: id="A" updated="20260925"}');
        expect(out).toContain('{: id="B" custom-pri="1"}');
    });
    it("子块、正文、引述块一字不差", () => {
        expect(out.split("\n").slice(1)).toEqual(KR.split("\n").slice(1));
    });
    it("第二个任务不受影响", () => {
        expect(out).toContain("\n- [ ] 另一个任务");
    });
    it("本来就是目标状态时也要幂等", () => {
        expect(setTaskDone(out, true)).toBe(out);
    });
});

describe("T4 非任务块", () => {
    it("普通列表项 / 段落 / 空串 → 返回 null，不抛异常", () => {
        expect(setTaskDone("- 普通列表项", true)).toBeNull();
        expect(setTaskDone("正文段落", true)).toBeNull();
        expect(setTaskDone("", true)).toBeNull();
        expect(isTaskKramdown("正文段落")).toBe(false);
    });
});

describe("T5 子任务判定", () => {
    it("父级是列表块、祖父是任务项 → 是子任务", () => {
        expect(isSubtask({ parentType: "l", grandType: "i", grandSubtype: "t" })).toBe(true);
    });
    it("祖父是标题（顶层任务）→ 不是子任务", () => {
        expect(isSubtask({ parentType: "l", grandType: "h", grandSubtype: "h2" })).toBe(false);
    });
    it("祖父是文档（顶层任务）→ 不是子任务", () => {
        expect(isSubtask({ parentType: "l", grandType: "d", grandSubtype: "" })).toBe(false);
    });
    it("缺字段 → 不是子任务，不抛异常", () => {
        expect(isSubtask({})).toBe(false);
    });
});

describe("W13 取标题（不能把子块文本带进来）", () => {
    it("带 ial 的 kramdown", () => {
        expect(taskTitleFromKramdown('- {: id="A" updated="1"}[ ] 写周报\n\n  正文')).toBe("写周报");
    });
    it("已完成标记", () => {
        expect(taskTitleFromKramdown("- [X] 复习 JVM")).toBe("复习 JVM");
    });
    it("没有标记时退回首行", () => {
        expect(taskTitleFromKramdown("普通段落")).toBe("普通段落");
    });
    it("空输入不抛", () => {
        expect(taskTitleFromKramdown("")).toBe("");
    });
});

describe("W14 缩进的任务标记（SQL 的 markdown 列会带缩进，块级 kramdown 不带）", () => {
    it("带缩进也认得出是任务", () => {
        expect(isTaskKramdown("  - [ ] 子任务")).toBe(true);
        expect(isTaskKramdown("    - [X] 更深")).toBe(true);
    });
    it("取标题时去掉缩进", () => {
        expect(taskTitleFromKramdown("  - [ ] 子任务")).toBe("子任务");
    });
    it("切换完成状态**必须保住缩进**（否则嵌套结构会被压平）", () => {
        expect(setTaskDone("  - [ ] 子任务", true)).toBe("  - [X] 子任务");
        expect(setTaskDone("    - [X] 更深", false)).toBe("    - [ ] 更深");
    });
    it("带 ial 且带缩进", () => {
        expect(setTaskDone('  - {: id="A"}[ ] t', true)).toBe('  - {: id="A"}[X] t');
        expect(taskTitleFromKramdown('  - {: id="A"}[ ] t')).toBe("t");
    });
    it("非任务行不受影响", () => {
        expect(isTaskKramdown("  普通段落")).toBe(false);
        expect(setTaskDone("  普通段落", true)).toBeNull();
    });
});
