// @vitest-environment happy-dom
import { cleanup, act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskPanel, type TaskPanelHost } from "../../src/ui/TaskPanel";

function makeHost(over: Partial<TaskPanelHost> = {}): TaskPanelHost {
    return {
        currentBlockId: async () => "T1",
        readAttrs: async () => ({ "custom-due": "20260925", "custom-pri": "1" }),
        writeAttrs: async () => undefined,
        childTasks: async () => [],
        addSubTask: async () => undefined,
        linkToParent: async () => undefined,
        detach: async () => undefined,
        renameTask: async () => undefined,
        setTags: async () => undefined,
        tagsOf: async () => [],
        toggleDone: async () => undefined,
        isDone: async () => false,
        title: async () => "写周报",
        openBlock: () => undefined,
        removeBlock: async () => undefined,
        takeFocus: () => null,
        toast: () => undefined,
        now: () => new Date(2026, 8, 25, 10, 0),
        ...over,
    };
}

// RTL 的自动清理要靠全局 afterEach，本仓库没开 vitest globals，
// 不显式清理的话面板会在用例之间累积 —— querySelector 会一直命中第一个（陈旧的）
afterEach(() => {
    cleanup();
    (document.activeElement as HTMLElement | null)?.blur?.();
});

const mount = async (host: TaskPanelHost) => {
    await act(async () => {
        render(<TaskPanel host={host} />);
    });
    // 等「就绪」而不是等「有输入框」：属性是异步读的，
    // 只等输入框会拿到 attrs 还是空的那一帧
    await waitFor(() => {
        if (!document.querySelector('.jiesheng-panel[data-state="ready"]')) {
            throw new Error("面板还没就绪");
        }
    });
};

describe("P0 打开面板时的焦点（设计 T8 要求「面板打开且日期区获得焦点」）", () => {
    it("host 请求聚焦 due → 焦点落在截止输入框", async () => {
        let taken = false;
        await mount(makeHost({
            takeFocus: () => {
                if (taken) return null;
                taken = true;
                return "due";
            },
        }));
        await waitFor(() => {
            const el = document.activeElement;
            expect(el?.getAttribute("placeholder")).toContain("yyyy-MM-dd");
        });
    });

    it("host 没有请求 → 不主动抢焦点（别把光标从编辑器里夺走）", async () => {
        await mount(makeHost({ takeFocus: () => null }));
        expect(document.activeElement).toBe(document.body);
    });

    it("请求只生效一次：take 过之后不能再抢焦点", async () => {
        let calls = 0;
        const host = makeHost({
            takeFocus: () => { calls += 1; return calls === 1 ? "due" : null; },
        });
        await mount(host);
        expect(calls).toBeGreaterThanOrEqual(1);
        expect(document.activeElement).not.toBe(document.body);
    });
});

describe("P1 标题与跳转", () => {
    it("显示 host 给的标题（标题是可编辑输入框 —— 改名即文档重命名）", async () => {
        await mount(makeHost());
        await waitFor(() => {
            const el = document.querySelector(".jiesheng-panel input") as HTMLInputElement;
            expect(el.value).toBe("写周报");
        });
    });
    it("点「跳转到块」调用 host.openBlock", async () => {
        const seen: string[] = [];
        await mount(makeHost({ openBlock: (id) => seen.push(id) }));
        const link = [...document.querySelectorAll(".jiesheng-panel a")]
            .find((a) => a.textContent?.includes("跳转")) as HTMLElement;
        await act(async () => { link.click(); });
        expect(seen).toEqual(["T1"]);
    });
});

describe("P2 全天开关反映 due 的形态（不单独存字段）", () => {
    it("due 有时间 → 全天未勾选", async () => {
        await mount(makeHost({ readAttrs: async () => ({ "custom-due": "202609251430" }) }));
        const box = document.querySelector(".jiesheng-panel input[type=checkbox]") as HTMLInputElement;
        expect(box.checked).toBe(false);
    });
    it("due 是 8 位 → 全天已勾选", async () => {
        await mount(makeHost({ readAttrs: async () => ({ "custom-due": "20260925" }) }));
        const box = document.querySelector(".jiesheng-panel input[type=checkbox]") as HTMLInputElement;
        expect(box.checked).toBe(true);
    });
    it("没有 due → 视为全天（新任务默认）", async () => {
        await mount(makeHost({ readAttrs: async () => ({}) }));
        const box = document.querySelector(".jiesheng-panel input[type=checkbox]") as HTMLInputElement;
        expect(box.checked).toBe(true);
    });
});

describe("P3 输入框不能在每次按键时就写库（曾经的真 bug：敲第一个字符就把日期抹成空）", () => {
    it("在截止框里输入过程中不写库", async () => {
        const writes: Record<string, string>[] = [];
        await mount(makeHost({ writeAttrs: async (_id, patch) => { writes.push(patch); } }));
        const due = document.querySelector('.jiesheng-panel [data-jie="due"]') as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            setter.call(due, "2026-10-01");
            due.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(writes).toEqual([]);
    });
    it("失焦时才写库，且保留原时刻", async () => {
        const writes: Record<string, string>[] = [];
        await mount(makeHost({
            readAttrs: async () => ({ "custom-due": "202609251430" }),
            writeAttrs: async (_id, patch) => { writes.push(patch); },
        }));
        const due = document.querySelector('.jiesheng-panel [data-jie="due"]') as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            setter.call(due, "2026-10-01");
            due.dispatchEvent(new Event("input", { bubbles: true }));
            due.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(writes).toHaveLength(1);
        expect(writes[0]["custom-due"]).toBe("20261001");
    });
});

describe("P4 面板展开有动画：对还不可见的元素 focus() 是空操作，必须重试", () => {
    it("前两次 focus 无效时会继续重试，直到真的聚焦", async () => {
        const real = HTMLElement.prototype.focus;
        let calls = 0;
        HTMLElement.prototype.focus = function (this: HTMLElement) {
            calls += 1;
            if (calls >= 3) real.call(this);
        };
        try {
            await mount(makeHost({ takeFocus: () => "due" }));
            await waitFor(() => {
                expect(document.activeElement?.getAttribute("data-jie")).toBe("due");
            });
            expect(calls).toBeGreaterThanOrEqual(3);
        } finally {
            HTMLElement.prototype.focus = real;
        }
    });

    it("始终不可聚焦 → 重试有限次后放弃，不死循环", async () => {
        const real = HTMLElement.prototype.focus;
        let calls = 0;
        HTMLElement.prototype.focus = function () { calls += 1; };
        try {
            await mount(makeHost({ takeFocus: () => "due" }));
            await new Promise((r) => setTimeout(r, 1600));
            expect(calls).toBe(21); // 首次 + 最多 20 次重试
        } finally {
            HTMLElement.prototype.focus = real;
        }
    });
});
