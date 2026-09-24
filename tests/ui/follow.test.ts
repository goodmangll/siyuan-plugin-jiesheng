// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createFollowScheduler, selectionIsInEditor } from "../../src/ui/follow";

describe("F1 防抖调度（selectionchange 会疯狂触发，不能每次都刷）", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("连续 poke 只执行一次", () => {
        const run = vi.fn();
        const s = createFollowScheduler(run, 100);
        s.poke(); s.poke(); s.poke();
        vi.advanceTimersByTime(150);
        expect(run).toHaveBeenCalledTimes(1);
    });
    it("隔开足够久 → 各执行一次", () => {
        const run = vi.fn();
        const s = createFollowScheduler(run, 100);
        s.poke(); vi.advanceTimersByTime(150);
        s.poke(); vi.advanceTimersByTime(150);
        expect(run).toHaveBeenCalledTimes(2);
    });
    it("stop 之后不再执行", () => {
        const run = vi.fn();
        const s = createFollowScheduler(run, 100);
        s.poke(); s.stop();
        vi.advanceTimersByTime(500);
        expect(run).not.toHaveBeenCalled();
    });
});

describe("F2 光标是不是在编辑器里（在面板输入框里选文字不该触发刷新）", () => {
    const el = (cls: string) => {
        const d = document.createElement("div");
        d.className = cls;
        return d;
    };
    it("在 protyle 里 → 是", () => {
        const root = el("protyle-wysiwyg");
        const p = document.createElement("p");
        root.appendChild(p);
        expect(selectionIsInEditor(p)).toBe(true);
    });
    it("在面板里 → 不是", () => {
        const panel = el("task-flow-panel");
        const input = document.createElement("input");
        panel.appendChild(input);
        expect(selectionIsInEditor(input)).toBe(false);
    });
    it("null → 不是", () => {
        expect(selectionIsInEditor(null)).toBe(false);
    });
});
