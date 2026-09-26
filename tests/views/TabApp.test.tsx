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
 * 一个「SQL 视图」的假实现：按视图名给不同的行。
 *
 * `delayMs` 用来模拟思源的两个慢点：属性写入对 SQL 有约 1.3 秒的可见延迟，
 * 以及 load / counts 各自要几十毫秒。
 */
function makeHost(opts: {
    rowsByView: Partial<Record<ViewId, ViewTask[]>>;
    /** 第一次 load(done) 返回空（模拟「写入还没对 SQL 可见」） */
    doneEmptyOnce?: boolean;
    toggleDoneDelay?: number;
} ): ViewHost {
    let doneCalls = 0;
    const host = {
        today: () => TODAY,
        nowStamp: () => "202609262300",
        load: vi.fn(async (view: ViewId) => {
            if (view === "done") {
                doneCalls += 1;
                if (opts.doneEmptyOnce && doneCalls === 1) {
                    return [];
                }
            }
            return opts.rowsByView[view] ?? [];
        }),
        counts: vi.fn(async () => {
            const done = (opts.rowsByView.done ?? []).length;
            const all = (opts.rowsByView.all ?? []).length;
            return { today: (opts.rowsByView.today ?? []).length, tomorrow: 0, next7: 0, inbox: 0, all, done };
        }),
        lists: vi.fn(async () => []),
        loadRange: vi.fn(async () => []),
        trends: vi.fn(async () => ({ created: [], done: [] })),
        distributions: vi.fn(async () => ({ byList: [], byPriority: [] })),
        toggleDone: vi.fn(async () => {
            if (opts.toggleDoneDelay) {
                await new Promise((r) => setTimeout(r, opts.toggleDoneDelay));
            }
        }),
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
    } as unknown as ViewHost;
    return host;
}

async function clickNav(label: string): Promise<void> {
    const nav = document.querySelector(".tf-tab nav");
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
    const tab = document.querySelector(".tf-tab");
    const m = /(\d+)\s*项/.exec(tab?.textContent ?? "");
    return m ? m[1] : "(没有 N 项)";
}

/** 侧栏「已完成」后面的数字 */
function navCount(label: string): string {
    const nav = document.querySelector(".tf-tab nav");
    const item = [...(nav?.querySelectorAll("div") ?? [])]
        .find((e) => e.textContent?.trim().startsWith(label));
    const m = /(\d+)\s*$/.exec(item?.textContent?.trim() ?? "");
    return m ? m[1] : "";
}

describe("TabApp · 写库期间切视图（真机踩到的竞态）", () => {
    it("写库 resolve 后那次 reload 必须用**当前**视图，不能用点击时的旧视图", async () => {
        // 今天的列表里有一条未完成任务；「已完成」里有它完成后的样子
        const host = makeHost({
            rowsByView: { today: [task()], done: [task({ done: "202609262300" })] },
            toggleDoneDelay: 60, // 模拟写库要等一会儿（真机约 1.3 秒）
        });
        render(<TabApp host={host} initialView="today" />);
        await waitFor(() => expect(mainCount()).toBe("1"));

        // 勾选完成（乐观：行立刻消失）
        const box = document.querySelector(".tf-row input[type=checkbox]") as HTMLInputElement;
        await act(async () => { box.click(); });

        // ★ 写库还没回来，用户已经切到「已完成」
        await act(async () => {
            await clickNav("已完成");
        });

        // 等写库 resolve（它触发的 reload 也在这一步跑完）
        await act(async () => {
            await new Promise((r) => setTimeout(r, 120));
        });

        // 断言①：那次 reload 查的是 done，不是 today
        const views = (host.load as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
        const lastView = views[views.length - 1];
        expect(lastView).toBe("done");

        // 断言②：列表和侧栏数字一致，都是 1（修复前是「0 项 + 侧栏 1」）
        expect(mainCount()).toBe("1");
        expect(navCount("已完成")).toBe("1");
    });

    it("过期的 reload 结果不落地（后发起的先回来也不能覆盖）", async () => {
        const host = makeHost({
            rowsByView: { today: [task()], done: [task({ done: "202609262300" })] },
        });
        // 让第一次 load(today) 拖很久，第二次 load(done) 立刻回来
        let first = true;
        (host.load as ReturnType<typeof vi.fn>).mockImplementation(async (view: ViewId) => {
            if (first) {
                first = false;
                await new Promise((r) => setTimeout(r, 80));
                return [];
            }
            return view === "done" ? [task({ done: "202609262300" })] : [];
        });

        render(<TabApp host={host} initialView="today" />);
        // 切到 done —— 这一次的 load 会很快回来
        await act(async () => {
            await clickNav("已完成");
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(mainCount()).toBe("1");

        // 那一次慢的（过期的）此时才回来，不该把界面改回 0
        await act(async () => {
            await new Promise((r) => setTimeout(r, 120));
        });
        expect(mainCount()).toBe("1");
    });
});
