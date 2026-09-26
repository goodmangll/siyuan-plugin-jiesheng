import { describe, expect, it, vi } from "vitest";
import { buildViewHost, type HostDeps } from "../../src/plugin/hosts";

/**
 * 只测「装配出来的东西形状对不对」——具体取数逻辑由集成测试真跑内核守着。
 * 这里能存在本身就说明 hosts.ts 已经脱离思源可加载（原来长在 Plugin 子类上，做不到）。
 */
function deps(): HostDeps {
    return {
        session: {
            pinned: () => null, pin: vi.fn(), currentBlockId: async () => null,
            onFollow: vi.fn(), takeFocus: () => null, openPanel: vi.fn(), openTab: vi.fn(),
        },
        notebookMap: async () => ({}),
        todayStr: () => "20260926",
        eventBus: { on: vi.fn(), off: vi.fn() },
        openBlock: vi.fn(),
        openSettings: vi.fn(),
        toggleDone: vi.fn(),
        afterCompleted: vi.fn(),
        createTask: vi.fn(),
        promoteToTask: vi.fn(),
        forgetTask: vi.fn(),
        transportReady: () => true,
        toast: vi.fn(),
        errorToast: vi.fn(),
    };
}

describe("hosts · 视图宿主", () => {
    it("该有的方法一个不少（漏一个就是真机上的白屏或静默失效）", () => {
        const h = buildViewHost(deps()) as unknown as Record<string, unknown>;
        for (const k of [
            "today", "nowStamp", "load", "counts", "loadRange", "trends", "distributions",
            "lists", "setTags", "toggleDone", "openBlock", "openDetail", "setDue",
            "setPriority", "setList", "createTask", "childTasks", "addSubTask",
            "linkToParent", "detach", "renameTask", "subscribe", "toast",
        ]) {
            expect(typeof h[k], k).toBe("function");
        }
    });

    it("订阅：任务无关的内核推送不触发刷新", () => {
        const d = deps();
        const h = buildViewHost(d);
        const onChange = vi.fn();
        const unsubscribe = h.subscribe!(onChange);
        // 把 handler 抓出来自己喂事件（比去 mock 整个思源 eventBus 便宜）
        const handler = (d.eventBus.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (e: CustomEvent) => void;
        handler({ detail: { cmd: "reloadPlugin", data: {} } } as unknown as CustomEvent);
        handler({ detail: { cmd: "backgroundtask", data: {} } } as unknown as CustomEvent);
        expect(onChange).not.toHaveBeenCalled();
        unsubscribe();
    });

    it("订阅：改了任务属性会刷新（防抖后）", async () => {
        const d = deps();
        const h = buildViewHost(d);
        const onChange = vi.fn();
        h.subscribe!(onChange);
        const handler = (d.eventBus.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (e: CustomEvent) => void;
        handler({ detail: { cmd: "transactions", data: [{ doOperations: [{ action: "updateAttrs", data: { new: { "custom-pri": "1" } } }] }] } } as unknown as CustomEvent);
        await new Promise((r) => setTimeout(r, 200));
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("取消订阅会摘掉 handler（否则 Tab 关了还在刷）", () => {
        const d = deps();
        const un = buildViewHost(d).subscribe!(vi.fn());
        un();
        expect((d.eventBus.off as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });
});
