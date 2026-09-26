// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createFollowScheduler, nextPinned, selectionIsInEditor } from "../../src/ui/follow";

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
        const panel = el("jiesheng-panel");
        const input = document.createElement("input");
        panel.appendChild(input);
        expect(selectionIsInEditor(input)).toBe(false);
    });
    it("null → 不是", () => {
        expect(selectionIsInEditor(null)).toBe(false);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 回归：点一条任务后面板变空
 *
 * 根因是「固定」被**我们自己触发的点击**清掉了 —— 见 follow.ts 的注释。
 * 这几条按当时的真机日志写死顺序。
 * ──────────────────────────────────────────────────────────────────────────── */
describe("面板固定：什么时候解除", () => {
    const A = "20260101000000-abcdefg";

    it("程序化打开面板（点 dock 图标）诱发的那次 selectionchange 不该清掉固定", () => {
        // 真机日志（修复前）：
        //   openDetail 设完 pinned=A
        //   点击Tab外 → 清 pinned（原=A） target=dock__item
        //   currentBlockId → null        ← 面板变空状态
        // 后来换成「光标落进编辑器就解除」，同样被打中：
        //   openDock() 的点击会诱发一次 selectionchange，锚点还在原编辑器里。
        // 所以只有「光标换了块」才算数。
        expect(nextPinned(A, "caret-same")).toBe(A);
    });

    it("光标换了个块 → 解除固定，改为跟随光标", () => {
        expect(nextPinned(A, "caret-moved")).toBeNull();
    });

    it("选区在面板自己的输入框里 → 不解除（否则改标题就把固定丢了）", () => {
        expect(nextPinned(A, "selection-outside-editor")).toBe(A);
    });

    it("本来就没固定 → 一直是 null", () => {
        expect(nextPinned(null, "caret-moved")).toBeNull();
        expect(nextPinned(null, "caret-same")).toBeNull();
        expect(nextPinned(null, "selection-outside-editor")).toBeNull();
    });
});

describe("F2 来源合并：同一防抖窗口内，切文档不被 selectionchange 盖掉", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("先 switch-doc 再 caret，仍然按 switch-doc 处理", () => {
        const seen: string[] = [];
        const s = createFollowScheduler((r) => seen.push(r));
        s.poke("switch-doc");
        s.poke("caret");     // 切文档必然会连带发一次 selectionchange
        s.poke("caret");
        vi.advanceTimersByTime(200);
        expect(seen).toEqual(["switch-doc"]);
    });

    it("只有 caret → 按 caret 处理", () => {
        const seen: string[] = [];
        const s = createFollowScheduler((r) => seen.push(r));
        s.poke("caret");
        vi.advanceTimersByTime(200);
        expect(seen).toEqual(["caret"]);
    });

    it("合并标记不会漏到下一轮", () => {
        const seen: string[] = [];
        const s = createFollowScheduler((r) => seen.push(r));
        s.poke("switch-doc");
        vi.advanceTimersByTime(200);
        s.poke("caret");
        vi.advanceTimersByTime(200);
        expect(seen).toEqual(["switch-doc", "caret"]);
    });
});
