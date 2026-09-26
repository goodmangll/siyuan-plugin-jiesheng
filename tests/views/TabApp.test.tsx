// @vitest-environment happy-dom
import { cleanup, act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabApp } from "../../src/views/TabApp";
import type { ViewHost, ViewId } from "../../src/views/host";
import type { ViewTask } from "../../src/views/model";

afterEach(cleanup);

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

/**
 * 一个会**模拟思源写入延迟**的假 host。
 *
 * 必须模拟，否则测不出要测的东西：真实的 host 里 `load` / `counts` 会先等
 * 在飞的写入落定（plugin 的 withWriteBarrier），而写入落定意味着 SQL 才刚追上。
 * 如果 mock 的 load 立即返回固定数据，就复现不出「SQL 快照比本地旧」。
 *
 * 所以这里维护两份「SQL 眼里的」列表：open（未完成）与 done（已完成）。
 * `toggleDone` resolve 时把它们挪一下 —— 那一刻 SQL 才更新。
 */
function makeHost(opts: {
    /** 初始未完成 */
    open?: ViewTask[];
    /** 初始已完成 */
    done?: ViewTask[];
    /** 写库耗时（真机约 1300ms） */
    writeDelay?: number;
    /** 额外延迟：模拟 SQL 查询本身要几十毫秒 */
    readDelay?: number;
} = {}): ViewHost & { __sql: () => { open: ViewTask[]; done: ViewTask[] }; __poke: () => void } {
    let open = [...(opts.open ?? [])];
    let done = [...(opts.done ?? [])];
    let inflight: Promise<unknown> = Promise.resolve();
    const subscribers: (() => void)[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const host = {
        __sql: () => ({ open, done }),
        __poke: () => { for (const f of [...subscribers]) { f(); } },
        today: () => TODAY,
        nowStamp: () => "202609262300",
        // 读：先等在飞的写落定（和 plugin 的 withWriteBarrier 一致）
        load: vi.fn(async (view: ViewId) => {
            await inflight;
            // ★ 快照在**查询发起时**定下，延迟之后才返回 —— 真实 SQL 就是这样。
            //   不这么写就复现不出「点击前发起的 reload 带着旧快照落地」。
            const snap = view === "done" ? [...done] : view === "all" ? [...open]
                : [...open].filter((t) => t.due === TODAY);
            if (opts.readDelay) { await delay(opts.readDelay); }
            return snap;
        }),
        counts: vi.fn(),
        // ★ 真实 host 是「列表 + 数字一次取回」（同一条 SQL、同一份快照）。
        //   mock 也必须如此，否则测不出「两条查询跨过索引提交那一刻」那类问题：
        //   真机抓到过「列表 1 行、侧栏 done=2」—— 数字已含这笔改动、
        //   列表还没有，覆盖层保留的同时差额又被加了一次。
        loadWithCounts: vi.fn(async (view: ViewId) => {
            await inflight;
            const snap = view === "done" ? [...done] : view === "all" ? [...open]
                : [...open].filter((t) => t.due === TODAY);
            if (opts.readDelay) { await delay(opts.readDelay); }
            return {
                tasks: snap,
                counts: {
                    today: open.filter((t) => t.due === TODAY).length,
                    tomorrow: 0, next7: 0, inbox: 0,
                    all: open.length, done: done.length,
                },
            };
        }),
        toggleDone: vi.fn(async (id: string) => {
            const p = (async () => {
                // 写库：属性写下去到 SQL 可见，要这么久
                await delay(opts.writeDelay ?? 0);
                const t = open.find((x) => x.id === id);
                if (t) {
                    open = open.filter((x) => x.id !== id);
                    done = [{ ...t, done: "202609262300" }, ...done];
                }
            })();
            inflight = p.then(() => undefined, () => undefined);
            return p;
        }),
        subscribe: (onChange: () => void) => {
            subscribers.push(onChange);
            return () => {
                const i = subscribers.indexOf(onChange);
                if (i >= 0) { subscribers.splice(i, 1); }
            };
        },
        lists: vi.fn(async () => []),
        loadRange: vi.fn(async () => []),
        trends: vi.fn(async () => ({ created: [], done: [] })),
        distributions: vi.fn(async () => ({ byList: [], byPriority: [] })),
        openBlock: vi.fn(),
        openDetail: vi.fn(),
        setDue: vi.fn(async () => {}),
        setPriority: vi.fn(async () => {}),
        setList: vi.fn(async () => {}),
        createTask: vi.fn(async () => {}),
        childTasks: vi.fn(async () => []),
        addSubTask: vi.fn(async () => {}),
        linkToParent: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        renameTask: vi.fn(async () => {}),
        setTags: vi.fn(async () => {}),
    } as unknown as ViewHost & { __sql: () => { open: ViewTask[]; done: ViewTask[] }; __poke: () => void };
    return host;
}

async function clickNav(label: string): Promise<void> {
    const nav = document.querySelector(".jie-tab nav");
    const item = [...(nav?.querySelectorAll("div") ?? [])]
        .find((e) => e.textContent?.trim().startsWith(label));
    if (!item) {
        throw new Error(`导航里没找到「${label}」`);
    }
    await act(async () => {
        (item as HTMLElement).click();
    });
}

/** 主区标题里的「N 项」 */
function mainCount(): string {
    const tab = document.querySelector(".jie-tab");
    const m = /(\d+)\s*项/.exec(tab?.textContent ?? "");
    return m ? m[1] : "(没有 N 项)";
}

/** 侧栏「已完成」后面的数字 */
function navCount(label: string): string {
    const nav = document.querySelector(".jie-tab nav");
    const item = [...(nav?.querySelectorAll("div") ?? [])]
        .find((e) => e.textContent?.trim().startsWith(label));
    const m = /(\d+)\s*$/.exec(item?.textContent?.trim() ?? "");
    return m ? m[1] : "";
}

describe("TabApp · 写库期间切视图（真机踩到的竞态）", () => {
    it("写库 resolve 后那次 reload 必须用**当前**视图，不能用点击时的旧视图", async () => {
        const host = makeHost({ open: [task()], writeDelay: 60 });
        render(<TabApp host={host} initialView="today" />);
        await waitFor(() => expect(mainCount()).toBe("1"));

        await act(async () => {
            (document.querySelector(".jie-row input[type=checkbox]") as HTMLInputElement).click();
        });
        // 写库还没回来，用户已经切到「已完成」
        await act(async () => { await clickNav("已完成"); });
        await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

        const views = (host.loadWithCounts as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
        expect(views[views.length - 1]).toBe("done");
        expect(mainCount()).toBe("1");
        expect(navCount("已完成")).toBe("1");
    });

    it("过期的 reload 结果不落地（后发起的先回来也不能覆盖）", async () => {
        // 手动让 `load` 第一次极慢、之后很快
        const host = makeHost({ open: [task()] });
        let first = true;
        (host.loadWithCounts as ReturnType<typeof vi.fn>).mockImplementation(async (view: ViewId) => {
            if (first) {
                first = false;
                await new Promise((r) => setTimeout(r, 80));
                return { tasks: [], counts: { today: 0, tomorrow: 0, next7: 0, inbox: 0, all: 0, done: 0 } };
            }
            const tasks = view === "done" ? [{ ...task(), done: "202609262300" }] : [];
            return { tasks, counts: { today: tasks.length, tomorrow: 0, next7: 0, inbox: 0, all: tasks.length, done: tasks.length } };
        });

        render(<TabApp host={host} initialView="today" />);
        await act(async () => {
            await clickNav("已完成");
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(mainCount()).toBe("1");

        // 那一次慢的（过期的）此时才回来，不该把界面改回 0
        await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
        expect(mainCount()).toBe("1");
    });
});

describe("TabApp · 写入落定前切视图（本地完成态要盖住旧快照）", () => {
    it("点了完成后立刻切「已完成」，应**马上**看到它，不等 SQL", async () => {
        // 模拟真机：SQL 要 1.3 秒才追得上，所以此刻 load(done) 还是空的
        const host = makeHost({ open: [task()], done: [], writeDelay: 200 });
        render(<TabApp host={host} initialView="today" />);
        await waitFor(() => expect(mainCount()).toBe("1"));

        await act(async () => {
            (document.querySelector(".jie-row input[type=checkbox]") as HTMLInputElement).click();
        });

        // 写入还在飞，马上切到「已完成」
        await act(async () => {
            await clickNav("已完成");
        });

        // 断言：**立刻**就有内容（来自本地完成态），而不是等 SQL 回来
        expect(mainCount()).toBe("1");
        const rows = document.querySelectorAll(".jie-row");
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain("任务一");
        expect(navCount("已完成")).toBe("1");
    });

    it("写入落定、SQL 追上之后，界面不许回退", async () => {
        const host = makeHost({ open: [task()], done: [], writeDelay: 60, readDelay: 20 });
        render(<TabApp host={host} initialView="today" />);
        await waitFor(() => expect(mainCount()).toBe("1"));

        await act(async () => {
            (document.querySelector(".jie-row input[type=checkbox]") as HTMLInputElement).click();
            await clickNav("已完成");
        });
        expect(mainCount()).toBe("1");

        // 写入 resolve，并触发一次 reload（SQL 此时仍可能是旧的）
        await act(async () => {
            await new Promise((r) => setTimeout(r, 150));
        });
        expect(mainCount()).toBe("1");
    });
});

describe("TabApp · 点击之前就发起的那次刷新（旧快照不许落地）", () => {
    it("旧快照回来时，乐观结果不能被覆盖（真机：今天又冒出那条任务）", async () => {
        // writeDelay 故意开大：让这次旧快照落地时**还没有**更新的 reload 出现，
        // 否则代次号守卫会把它挡掉，就测不到覆盖层这一层了
        const host = makeHost({ open: [task()], readDelay: 250, writeDelay: 2000 });
        render(<TabApp host={host} initialView="today" />);
        await waitFor(() => expect(mainCount()).toBe("1"));

        // 模拟 `ws-main`：一次外部刷新（此时写入还没发生，它带着「今天有 1 条」的快照）
        await act(async () => {
            host.__poke();
            await new Promise((r) => setTimeout(r, 30));
        });

        // 就在这次慢查询飞在天上的时候，点完成
        await act(async () => {
            (document.querySelector(".jie-row input[type=checkbox]") as HTMLInputElement).click();
        });
        expect(mainCount()).toBe("0");

        // 等那次旧快照落地 —— 它带回来的是「今天 1 条」，**不许**覆盖乐观结果
        await act(async () => {
            await new Promise((r) => setTimeout(r, 400));
        });
        // 断言时写入还没落定（writeDelay 2000），所以这一刻吃的完全是覆盖层
        expect(host.__sql().open.length).toBe(1); // SQL 眼里还没完成
        expect(mainCount()).toBe("0");
        expect(document.querySelectorAll(".jie-row").length).toBe(0);
    });
});
