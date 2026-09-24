import { describe, expect, it, vi } from "vitest";
import { waitFor } from "../../src/util/waitFor";

describe("WF 有界轮询（思源的属性写入对 SQL 不是立即可见，写完要等它可见）", () => {
    it("第一次就满足 → 立即返回，不额外等", async () => {
        const fn = vi.fn(async () => 1);
        expect(await waitFor(fn, (v) => v === 1, { timeoutMs: 500 })).toBe(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("第 3 次才满足 → 会重试到满足", async () => {
        let n = 0;
        const fn = async () => { n += 1; return n; };
        expect(await waitFor(fn, (v) => v >= 3, { timeoutMs: 2000, intervalMs: 10 })).toBe(3);
        expect(n).toBe(3);
    });

    it("超时 → 返回最后一次的值，**不抛**（写入已经成功了，不该让调用方炸）", async () => {
        const fn = async () => "旧值";
        const got = await waitFor(fn, (v) => v === "新值", { timeoutMs: 120, intervalMs: 20 });
        expect(got).toBe("旧值");
    });

    it("fn 抛错时也重试（查询可能暂时失败）", async () => {
        let n = 0;
        const fn = async () => { n += 1; if (n < 2) throw new Error("boom"); return "好了"; };
        expect(await waitFor(fn, (v) => v === "好了", { timeoutMs: 1000, intervalMs: 10 })).toBe("好了");
    });

    it("一直抛错 → 返回 null，不把异常抛出去", async () => {
        const fn = async (): Promise<string> => { throw new Error("一直炸"); };
        expect(await waitFor(fn, (v) => v === "x", { timeoutMs: 100, intervalMs: 10 })).toBeNull();
    });
});
