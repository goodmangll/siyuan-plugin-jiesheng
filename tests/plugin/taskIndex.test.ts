import { describe, expect, it, vi } from "vitest";
import { createTaskIndex } from "../../src/plugin/taskIndex";

describe("TaskIndex · 块标菜单要的同步判断", () => {
    it("refresh 后能同步查到", async () => {
        const idx = createTaskIndex({ load: async () => ["a", "b"] });
        await idx.refresh();
        expect(idx.has("a")).toBe(true);
        expect(idx.has("b")).toBe(true);
        expect(idx.has("c")).toBe(false);
    });

    it("null / undefined / 空串一律 false（不抛）", async () => {
        const idx = createTaskIndex({ load: async () => [] });
        await idx.refresh();
        expect(idx.has(null)).toBe(false);
        expect(idx.has(undefined)).toBe(false);
        expect(idx.has("")).toBe(false);
    });

    it("refresh 是全量替换，不是累加（否则取消标记的会一直留着）", async () => {
        let list = ["a", "b"];
        const idx = createTaskIndex({ load: async () => list });
        await idx.refresh();
        list = ["b"];
        await idx.refresh();
        expect(idx.has("a")).toBe(false);
        expect(idx.has("b")).toBe(true);
    });

    it("remember / forget 就地更新（自己刚改完标记，省一次查询）", async () => {
        const idx = createTaskIndex({ load: async () => [] });
        await idx.refresh();
        idx.remember("x");
        expect(idx.has("x")).toBe(true);
        idx.forget("x");
        expect(idx.has("x")).toBe(false);
    });

    it("load 失败不抛、也不清空已有内容（菜单宁可旧也别消失）", async () => {
        let fail = false;
        const onError = vi.fn();
        const idx = createTaskIndex({
            load: async () => {
                if (fail) {
                    throw new Error("网络炸了");
                }
                return ["a"];
            },
            onError,
        });
        await idx.refresh();
        fail = true;
        await idx.refresh();
        expect(idx.has("a")).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
