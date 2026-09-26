import { describe, expect, it, vi } from "vitest";
import { createTaskStore, type TaskStoreDeps } from "../../src/store/taskStore";
import type { ViewTask } from "../../src/views/model";

const TODAY = "20260926";

function task(over: Partial<ViewTask> = {}): ViewTask {
    return {
        id: "T1", title: "任务一", due: TODAY, start: null, day: TODAY,
        priority: "none", list: "", repeat: null, hasReminder: false,
        path: "/任务一", box: "nb", done: null, pinned: false,
        overdue: false, isToday: true, tags: [],
        ...over,
    };
}

function deps(opts: { open?: ViewTask[]; done?: ViewTask[] } = {}) {
    const state = { open: [...(opts.open ?? [])], done: [...(opts.done ?? [])] };
    const d = {
        today: TODAY,
        now: () => `${TODAY}2300`,
        onMutateError: vi.fn(),
        sql: () => state,
        load: vi.fn(async (v: string) =>
            v === "done" ? [...state.done] : v === "all" ? [...state.open]
                : [...state.open].filter((t) => t.due === TODAY)),
        counts: vi.fn(async () => ({
            today: state.open.filter((t) => t.due === TODAY).length,
            tomorrow: 0, next7: 0, inbox: 0,
            all: state.open.length, done: state.done.length,
        })),
    };
    return d as unknown as TaskStoreDeps & {
        sql(): { open: ViewTask[]; done: ViewTask[] };
        load: ReturnType<typeof vi.fn>;
        counts: ReturnType<typeof vi.fn>;
        onMutateError: ReturnType<typeof vi.fn>;
    };
}

const never = () => new Promise<void>(() => {});

describe("TaskStore · 派生：渲染 = base + pending", () => {
    it("刚完成的任务立刻从「今天」消失、并出现在「已完成」", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();
        expect(s.items().map((t) => t.id)).toEqual(["T1"]);

        void s.mutate("T1", task({ done: `${TODAY}2300` }), never);

        expect(s.items()).toEqual([]);
        s.setView("done");
        expect(s.items().map((t) => t.id)).toEqual(["T1"]);
    });

    it("侧栏数字同步：今天 -1、全部 -1、已完成 +1", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();
        void s.mutate("T1", task({ done: `${TODAY}2300` }), never);
        const c = s.counts();
        expect(c.today).toBe(0);
        expect(c.all).toBe(0);
        expect(c.done).toBe(1);
    });

    it("补进来的行排在最前（刚完成的在「已完成」里本来就最新）", async () => {
        const d = deps({ done: [task({ id: "OLD", done: `${TODAY}1000` })] });
        const s = createTaskStore(d);
        s.setView("done");
        await s.refresh();
        void s.mutate("NEW", task({ id: "NEW", done: `${TODAY}2300` }), never);
        expect(s.items().map((t) => t.id)).toEqual(["NEW", "OLD"]);
    });

    it("看板只放未完成：完成后立刻从看板消失", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        s.setView("board");
        await s.refresh();
        expect(s.items()).toHaveLength(1);
        void s.mutate("T1", task({ done: `${TODAY}2300` }), never);
        expect(s.items()).toHaveLength(0);
    });

    it("删除（after=null）→ 立刻从所有列表消失", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();
        void s.mutate("T1", null, never);
        expect(s.items()).toEqual([]);
        expect(s.counts().today).toBe(0);
    });
});

describe("TaskStore · 落定与对账", () => {
    it("写入落定后刷新一次，pending 撤掉、数据以 SQL 为准", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();

        await s.mutate("T1", task({ done: `${TODAY}2300` }), async () => {
            await new Promise((r) => setTimeout(r, 5));
            const st = d.sql();
            st.open.length = 0;
            st.done.push(task({ done: `${TODAY}2300` }));
        });

        s.setView("done");
        await new Promise((r) => setTimeout(r, 10));
        expect(s.items().map((t) => t.id)).toEqual(["T1"]);
        expect(s.counts().done).toBe(1);
    });

    it("★ 点击之前就发起的那次刷新，不许把乐观结果覆盖回去", async () => {
        const d = deps({ open: [task()] });
        let slow = false;
        d.load.mockImplementation(async (v: string) => {
            const snap = v === "done" ? [] : [task()];
            if (slow) {
                await new Promise((r) => setTimeout(r, 40));
            }
            return snap;
        });
        const s = createTaskStore(d);
        await s.refresh();

        slow = true;
        void s.refresh();
        void s.mutate("T1", task({ done: `${TODAY}2300` }), never);

        await new Promise((r) => setTimeout(r, 80));
        expect(s.items()).toEqual([]);
    });

    it("写失败要撤掉乐观改动，并把错误交给调用方去说", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();

        await s.mutate("T1", task({ done: `${TODAY}2300` }), async () => {
            throw new Error("网络炸了");
        });

        // 错误由调用方处理（弹提示），不塞进视图加载状态 ——
        // 塞进去会被下一次成功的刷新覆盖，真机现象是「错误一闪而过」
        expect(d.onMutateError).toHaveBeenCalledTimes(1);
        expect((d.onMutateError as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe("网络炸了");
        expect(s.status().state).toBe("ready");
        expect(s.items().map((t) => t.id)).toEqual(["T1"]); // 回到未完成
        expect(s.counts().today).toBe(1);
    });

    it("过期的刷新结果不落地（后发起的先回来也不能覆盖）", async () => {
        const d = deps({ open: [task()] });
        let first = true;
        d.load.mockImplementation(async (v: string) => {
            if (v === "done") {
                return [];
            }
            if (first) {
                first = false;
                await new Promise((r) => setTimeout(r, 40));
                return [];
            }
            return [task()];
        });
        const s = createTaskStore(d);
        void s.refresh();
        s.setView("all");
        await new Promise((r) => setTimeout(r, 80));
        expect(s.items().map((t) => t.id)).toEqual(["T1"]);
    });

    it("内核推送触发刷新，且同一批合并成一次", async () => {
        const d = deps({ open: [task()] });
        const s = createTaskStore(d);
        await s.refresh();
        const before = d.load.mock.calls.length;
        s.pokeKernelChange();
        s.pokeKernelChange();
        s.pokeKernelChange();
        await new Promise((r) => setTimeout(r, 250));
        expect(d.load.mock.calls.length).toBe(before + 1);
    });
});
