import { describe, expect, it } from "vitest";
import { dueEvents, advanceCursor, type TaskRow } from "../../src/notify/scan";
import { dispatch, type NotifyChannel } from "../../src/notify/dispatch";
import { formatRemindMessage } from "../../src/notify/format";

const NOW = "202609251000";
const CURSOR = "202609250900";

const row = (over: Partial<TaskRow> = {}): TaskRow => ({
    id: "T1", title: "写周报", remind: "202609250930", ...over,
});

describe("V1/V2 到期判定", () => {
    it("已到点且未推过 → 选出", () => {
        const evs = dueEvents([row()], NOW, CURSOR);
        expect(evs).toHaveLength(1);
        expect(evs[0].blockId).toBe("T1");
        expect(evs[0].remindAt).toBe("202609250930");
    });
    it("还没到点 → 排除", () => {
        expect(dueEvents([row({ remind: "202609251030" })], NOW, CURSOR)).toHaveLength(0);
    });
    it("已经推过（<= cursor）→ 排除，避免重复推送", () => {
        expect(dueEvents([row({ remind: "202609250900" })], NOW, CURSOR)).toHaveLength(0);
        expect(dueEvents([row({ remind: "202609250859" })], NOW, CURSOR)).toHaveLength(0);
    });
    it("边界：remindAt === now 要推；remindAt === cursor 不推", () => {
        expect(dueEvents([row({ remind: NOW })], NOW, CURSOR)).toHaveLength(1);
        expect(dueEvents([row({ remind: CURSOR })], NOW, CURSOR)).toHaveLength(0);
    });
});

describe("V3 多条提醒", () => {
    it("同一任务的多条提醒产出多个事件，各带自己的时刻", () => {
        const evs = dueEvents([row({ remind: "202609250920 202609250940 202609251030" })], NOW, CURSOR);
        expect(evs.map((e) => e.remindAt)).toEqual(["202609250920", "202609250940"]);
    });
    it("多条提醒都带同一个任务信息", () => {
        const evs = dueEvents([row({ remind: "202609250920 202609250940" })], NOW, CURSOR);
        expect(new Set(evs.map((e) => e.blockId))).toEqual(new Set(["T1"]));
    });
});

describe("V4 容错", () => {
    it("没有 remind / 非法 remind → 忽略，不抛", () => {
        expect(() => dueEvents([row({ remind: undefined })], NOW, CURSOR)).not.toThrow();
        expect(dueEvents([row({ remind: "abc 2026 20260925093000" })], NOW, CURSOR)).toHaveLength(0);
    });
    it("非法 remind 混在合法里 → 只取合法的", () => {
        const evs = dueEvents([row({ remind: "xx 202609250930" })], NOW, CURSOR);
        expect(evs.map((e) => e.remindAt)).toEqual(["202609250930"]);
    });
    it("空列表 → 空结果", () => {
        expect(dueEvents([], NOW, CURSOR)).toEqual([]);
    });
});

describe("V12 顺序稳定", () => {
    it("跨任务也按 remindAt 升序", () => {
        const evs = dueEvents([
            row({ id: "A", remind: "202609250950" }),
            row({ id: "B", remind: "202609250920" }),
            row({ id: "C", remind: "202609250935" }),
        ], NOW, CURSOR);
        expect(evs.map((e) => e.remindAt)).toEqual(["202609250920", "202609250935", "202609250950"]);
    });
});

describe("V5/V6 游标", () => {
    it("推进到已推事件的最大时刻（不是 now）", () => {
        const evs = dueEvents([row({ remind: "202609250920 202609250940" })], NOW, CURSOR);
        expect(advanceCursor(CURSOR, evs)).toBe("202609250940");
    });
    it("没有事件 → 游标不动", () => {
        expect(advanceCursor(CURSOR, [])).toBe(CURSOR);
    });
    it("游标只前进不后退（时钟回拨也不倒退）", () => {
        const evs = dueEvents([row({ remind: "202609250910" })], NOW, CURSOR);
        expect(advanceCursor("202609251200", evs)).toBe("202609251200");
    });
});

describe("V7-V10 分发", () => {
    const ch = (id: string, behaviour: "ok" | "fail" | "throw"): NotifyChannel => ({
        id,
        label: id,
        configKeys: () => ["url"],
        send: async () => {
            if (behaviour === "fail") return { ok: false, detail: "bad gateway" };
            if (behaviour === "throw") throw new Error("network down");
            return { ok: true };
        },
    });
    const ev = { blockId: "T", title: "写周报", remindAt: "202609250930" };

    it("所有已配置的通道都被调用", async () => {
        const r = await dispatch([ch("a", "ok"), ch("b", "ok")], { a: { url: "x" }, b: { url: "y" } }, ev);
        expect(r.map((x) => x.channelId)).toEqual(["a", "b"]);
        expect(r.every((x) => x.ok)).toBe(true);
    });
    it("未配置的通道被跳过", async () => {
        const r = await dispatch([ch("a", "ok"), ch("b", "ok")], { a: { url: "x" } }, ev);
        expect(r.map((x) => x.channelId)).toEqual(["a"]);
    });
    it("单通道失败不影响其它，且结果里标注失败", async () => {
        const r = await dispatch([ch("a", "fail"), ch("b", "ok")], { a: {}, b: {} }, ev);
        expect(r.find((x) => x.channelId === "a")?.ok).toBe(false);
        expect(r.find((x) => x.channelId === "a")?.detail).toContain("bad gateway");
        expect(r.find((x) => x.channelId === "b")?.ok).toBe(true);
    });
    it("通道抛异常被捕获，不中断分发", async () => {
        const r = await dispatch([ch("a", "throw"), ch("b", "ok")], { a: {}, b: {} }, ev);
        expect(r.find((x) => x.channelId === "a")?.ok).toBe(false);
        expect(r.find((x) => x.channelId === "a")?.detail).toContain("network down");
        expect(r.find((x) => x.channelId === "b")?.ok).toBe(true);
    });
});

describe("V11 消息文本", () => {
    it("包含标题与时刻", () => {
        const s = formatRemindMessage({ blockId: "T", title: "写周报", remindAt: "202609250930" });
        expect(s).toContain("写周报");
        expect(s).toContain("09-25 09:30");
    });
    it("有优先级时带上中文档位", () => {
        const s = formatRemindMessage({ blockId: "T", title: "x", remindAt: "202609250930", pri: "high" });
        expect(s).toContain("高");
    });
    it("没有优先级时不出现多余标记", () => {
        const s = formatRemindMessage({ blockId: "T", title: "x", remindAt: "202609250930" });
        expect(s).not.toContain("优先级");
    });
    it("超长标题被截断", () => {
        const s = formatRemindMessage({ blockId: "T", title: "啊".repeat(200), remindAt: "202609250930" });
        expect(s.length).toBeLessThan(200);
    });
});
