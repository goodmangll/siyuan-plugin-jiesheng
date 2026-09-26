import { describe, expect, it, vi } from "vitest";
import { createSession, type SessionDeps } from "../../src/plugin/session";

function deps(over: Partial<SessionDeps> = {}): SessionDeps & { refreshed: number } {
    const d = {
        refreshed: 0,
        openTab: vi.fn(),
        pluginName: () => "siyuan-plugin-task-flow",
        tabType: "taskFlowTab",
        dockType: "taskFlowDock",
        tabTitle: "任务",
        tabIcon: "iconTaskFlow",
        rawCaret: () => "block-A",
        resolveTask: async (id: string) => id,
        openBlock: vi.fn(),
        refreshPanel: () => { d.refreshed += 1; },
        expandDock: vi.fn(),
        toast: vi.fn(),
        ...over,
    } as SessionDeps & { refreshed: number };
    return d;
}

describe("EditorSession · 面板跟谁走", () => {
    it("没有固定时跟随光标（把块归一化到任务文档）", async () => {
        const d = deps({ rawCaret: () => "para-1", resolveTask: async () => "doc-1" });
        const s = createSession(d);
        expect(await s.currentBlockId()).toBe("doc-1");
    });

    it("固定之后不再看光标", async () => {
        const d = deps({ rawCaret: () => "para-1", resolveTask: async () => "doc-1" });
        const s = createSession(d);
        s.pin("doc-9");
        expect(await s.currentBlockId()).toBe("doc-9");
    });

    it("光标拿不到 → null，不抛（拿不到光标不该让调用方炸）", async () => {
        const d = deps({ rawCaret: () => null });
        const s = createSession(d);
        expect(await s.currentBlockId()).toBeNull();
    });
});

describe("EditorSession · 什么时候解除固定（真机踩过两次）", () => {
    it("光标换了个块 → 解除固定", async () => {
        const caret = { v: "block-A" };
        const s = createSession(deps({ rawCaret: () => caret.v }));
        await s.onFollow("caret"); // 先让 lastCaret = block-A
        s.pin("doc-9");
        caret.v = "block-B";
        await s.onFollow("caret");
        expect(s.pinned()).toBeNull();
    });

    it("★ 光标没动（我们自己打开面板引起的那次 selectionchange）→ 固定要留着", async () => {
        const s = createSession(deps({ rawCaret: () => "block-A" }));
        await s.onFollow("caret");
        s.pin("doc-9");
        // openDock() 是程序化 dockItem.click()，会诱发一次 selectionchange，锚点还在原处
        await s.onFollow("caret");
        expect(s.pinned()).toBe("doc-9");
    });

    it("切文档 → 一定解除固定（switch-doc 是无歧义的信号）", async () => {
        const s = createSession(deps({ rawCaret: () => "block-A" }));
        await s.onFollow("caret");
        s.pin("doc-9");
        await s.onFollow("switch-doc");
        expect(s.pinned()).toBeNull();
    });

    it("每次跟随都刷面板", async () => {
        const d = deps();
        const s = createSession(d);
        await s.onFollow("caret");
        await s.onFollow("caret");
        expect(d.refreshed).toBe(2);
    });
});

describe("EditorSession · 打开面板后的聚焦请求", () => {
    it("用「取走」而不是「读」——否则面板每次重渲染都会抢焦点", () => {
        const s = createSession(deps());
        s.openPanel("due");
        expect(s.takeFocus()).toBe("due");
        expect(s.takeFocus()).toBeNull();
        expect(s.takeFocus()).toBeNull();
    });

    it("不给字段名时默认聚焦日期区", () => {
        const s = createSession(deps());
        s.openPanel();
        expect(s.takeFocus()).toBe("due");
    });

    it("打开面板会先刷面板再展开 dock（顺序不能反）", () => {
        const order: string[] = [];
        const d = deps({
            refreshPanel: () => { order.push("refresh"); },
            expandDock: () => { order.push("expand"); },
        });
        const s = createSession(d);
        s.openPanel();
        expect(order).toEqual(["refresh", "expand"]);
    });
});
