import { describe, expect, it } from "vitest";
import { buildBlockMenuItems, type BlockMenuDeps, type MenuItemLike } from "../../src/ui/blockMenu";
import { ATTR } from "../../src/model/attrs";

const NOW = new Date(2026, 8, 25, 10, 0);

function makeDeps(over: Partial<BlockMenuDeps> = {}) {
    const written: { id: string; patch: Record<string, string> }[] = [];
    const opened: string[] = [];
    const calls = { promoted: [] as string[], demoted: [] as string[] };
    const deps: BlockMenuDeps = {
        now: () => NOW,
        readAttrs: async () => ({ [ATTR.due]: "20260925" }),
        writeAttrs: async (id, patch) => { written.push({ id, patch }); },
        openPanel: (id) => { opened.push(id); },
        promoteToTask: async (id) => { calls.promoted.push(id); },
        demoteFromTask: async (id) => { calls.demoted.push(id); },
        ...over,
    };
    return { deps, written, opened, calls };
}

describe("B4 非任务块不挂菜单", () => {
    // 注意：构建必须是**同步**的 —— click-blockicon 事件同步触发，
    // 若先 await 再 addItem，菜单已经渲染完了，项会丢。
    it("构建是同步的（返回值不是 Promise）", () => {
        const { deps } = makeDeps();
        expect(buildBlockMenuItems("TASK", deps)).not.toBeInstanceOf(Promise);
    });
    it("没有块 id → 空数组", () => {
        const { deps } = makeDeps();
        expect(buildBlockMenuItems(null, deps)).toEqual([]);
        expect(buildBlockMenuItems(undefined, deps)).toEqual([]);
        expect(buildBlockMenuItems("", deps)).toEqual([]);
    });
});

describe("B1/B2 菜单项", () => {
    it("挂上 11 项，label 与要求一致（加了「转为任务」「不再作为任务」）", () => {
        const { deps } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        expect(items.map((i) => i.label)).toEqual([
            "今天", "明天", "后天", "清除日期",
            "优先级 高", "优先级 中", "优先级 低", "清除优先级",
            "打开任务面板",
            "转为任务（建文档）", "不再作为任务",
        ]);
    });
    it("「不再作为任务」= 同类产品的「转为笔记」：只去掉标记，内容不动", async () => {
        const { deps, calls } = makeDeps();
        const item = buildBlockMenuItems("TASK", deps).find((i) => i.label === "不再作为任务");
        await item!.click();
        expect(calls.demoted).toEqual(["TASK"]);
    });
    it("「转为任务」把块升格成文档", async () => {
        const { deps, calls } = makeDeps();
        const item = buildBlockMenuItems("TASK", deps).find((i) => i.label === "转为任务（建文档）");
        await item!.click();
        expect(calls.promoted).toEqual(["TASK"]);
    });
    it("每项都有 icon 与 click", () => {
        const { deps } = makeDeps();
        for (const it of buildBlockMenuItems("TASK", deps)) {
            expect(typeof it.click).toBe("function");
            expect(typeof it.label).toBe("string");
            expect(it.label.length).toBeGreaterThan(0);
        }
    });
});

describe("B3 点击动作一一对应", () => {
    it("「今天」写 custom-due=today", async () => {
        const { deps, written } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        await items[0].click();
        expect(written).toEqual([{ id: "TASK", patch: { [ATTR.due]: "20260925" } }]);
    });
    it("「优先级 高」写 custom-pri=1", async () => {
        const { deps, written } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        await items[4].click();
        expect(written[0].patch).toEqual({ [ATTR.pri]: "1" });
    });
    it("「清除优先级」写空串", async () => {
        const { deps, written } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        await items[7].click();
        expect(written[0].patch).toEqual({ [ATTR.pri]: "" });
    });
    it("「打开任务面板」调用 openPanel 而不是写属性", async () => {
        const { deps, written, opened } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        await items[8].click();
        expect(opened).toEqual(["TASK"]);
        expect(written).toEqual([]);
    });
    it("后续项独立：点完「今天」再点「优先级 低」互不影响", async () => {
        const { deps, written } = makeDeps();
        const items = buildBlockMenuItems("TASK", deps);
        await items[0].click();
        await items[6].click();
        expect(written).toHaveLength(2);
        expect(written[1].patch).toEqual({ [ATTR.pri]: "3" });
    });
});

describe("容错", () => {
    it("读属性失败时，菜单仍能挂上（不抛）", async () => {
        const { deps } = makeDeps({ readAttrs: async () => { throw new Error("boom"); } });
        const items = buildBlockMenuItems("TASK", deps);
        expect(items.length).toBeGreaterThan(0);
    });
    it("写属性失败不应让 click 抛出未捕获的异常", async () => {
        const { deps } = makeDeps({ writeAttrs: async () => { throw new Error("boom"); } });
        const items = buildBlockMenuItems("TASK", deps);
        await expect(items[0].click()).resolves.toBeUndefined();
    });
    it("返回的每一项都能被当作普通菜单项使用（有 label/click）", () => {
        const { deps } = makeDeps();
        const items: MenuItemLike[] = buildBlockMenuItems("TASK", deps);
        expect(items[0]).toHaveProperty("label");
    });
});
