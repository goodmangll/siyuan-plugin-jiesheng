// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { runReminderScan, type ReminderRunnerDeps } from "../../src/ui/reminderRunner";

function makeDeps(over: Partial<ReminderRunnerDeps> = {}) {
    const toasts: string[] = [];
    const desks: { t: string; b: string }[] = [];
    let cursor: string | null = "202609250900";
    const deps: ReminderRunnerDeps = {
        now: () => "202609251000",
        readCursor: () => cursor,
        writeCursor: (c) => { cursor = c; },
        loadCandidates: async () => [
            { id: "A", title: "写周报", remind: "202609250930", due: "20260925", pri: "1", lst: "工作" },
        ],
        toast: (m) => toasts.push(m),
        notifyDesktop: (t, b) => desks.push({ t, b }),
        wantsInApp: () => true,
        wantsDesktop: () => true,
        ...over,
    };
    return { deps, toasts, desks, getCursor: () => cursor };
}

describe("R1 首次运行：不补推历史（否则界面一开就刷屏）", () => {
    it("没有游标 → 设成 now，一条都不推", async () => {
        const { deps, toasts, getCursor } = makeDeps({ readCursor: () => null });
        const r = await runReminderScan(deps);
        expect(r.fired).toBe(0);
        expect(toasts).toHaveLength(0);
        expect(getCursor()).toBe("202609251000");
    });
});

describe("R2 到点了就推，并在两个通道都出", () => {
    it("区间内的提醒 → 思源内提示 + 桌面通知，游标推进", async () => {
        const { deps, toasts, desks, getCursor } = makeDeps();
        const r = await runReminderScan(deps);
        expect(r.fired).toBe(1);
        expect(toasts).toHaveLength(1);
        expect(desks).toHaveLength(1);
        expect(desks[0].b).toContain("写周报");
        expect(getCursor()).toBe("202609250930");
    });
    it("已经推过的（≤ 游标）不再推", async () => {
        const { deps, toasts } = makeDeps({ readCursor: () => "202609250930" });
        const r = await runReminderScan(deps);
        expect(r.fired).toBe(0);
        expect(toasts).toHaveLength(0);
    });
    it("晚于 now 的还不推", async () => {
        const { deps } = makeDeps({
            loadCandidates: async () => [{ id: "A", title: "x", remind: "202609251200", due: null, pri: null, lst: null }],
        });
        expect((await runReminderScan(deps)).fired).toBe(0);
    });
});

describe("R3 开关：关掉就不走那个通道", () => {
    it("关掉思源内提示", async () => {
        const { deps, toasts, desks } = makeDeps({ wantsInApp: () => false });
        await runReminderScan(deps);
        expect(toasts).toHaveLength(0);
        expect(desks).toHaveLength(1);
    });
    it("关掉桌面通知", async () => {
        const { deps, toasts, desks } = makeDeps({ wantsDesktop: () => false });
        await runReminderScan(deps);
        expect(toasts).toHaveLength(1);
        expect(desks).toHaveLength(0);
    });
});

describe("R4 取数失败不能让游标乱动", () => {
    it("loadCandidates 抛错 → 不推、游标不变", async () => {
        const { deps, getCursor } = makeDeps({ loadCandidates: async () => { throw new Error("boom"); } });
        const r = await runReminderScan(deps);
        expect(r.fired).toBe(0);
        expect(getCursor()).toBe("202609250900");
    });
});

describe("R5 多条同时到点", () => {
    it("都推，游标推进到最大的那个", async () => {
        const { deps, toasts, getCursor } = makeDeps({
            loadCandidates: async () => [
                { id: "A", title: "甲", remind: "202609250920", due: null, pri: null, lst: null },
                { id: "B", title: "乙", remind: "202609250950", due: null, pri: null, lst: null },
            ],
        });
        const r = await runReminderScan(deps);
        expect(r.fired).toBe(2);
        expect(toasts).toHaveLength(2);
        expect(getCursor()).toBe("202609250950");
    });
});
