/**
 * Tab 内的 React 根：左侧导航 + 主区。
 *
 * 画布用全屏 Tab 而不是 Dock —— 看板要横排多列、日历要 7 列网格，侧栏放不下。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SmartListId } from "./query";
import { smartListIds, smartListsOf } from "./query";
import type { ViewHost, ViewId } from "./host";
import { VIEW_TABS } from "./host";
import type { ViewTask } from "./model";
import { TaskList } from "./TaskList";
import { Board } from "./Board";
import { Calendar } from "./Calendar";
import { Matrix } from "./Matrix";
import { Stats } from "./Stats";

const EMPTY_COUNTS = { today: 0, tomorrow: 0, next7: 0, inbox: 0, all: 0, done: 0 } as Record<SmartListId, number>;

export function TabApp({ host, initialView = "today" }: { host: ViewHost; initialView?: ViewId }) {
    const [view, setView] = useState<ViewId>(initialView);
    const [tasks, setTasks] = useState<ViewTask[]>([]);
    const [counts, setCounts] = useState<Record<SmartListId, number>>(EMPTY_COUNTS);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");

    const today = host.today();

    /**
     * 当前视图。
     *
     * **reload 不能闭包捕获 `view`** —— 真机踩到：`onChanged` 是
     * `useCallback(..., [reload])`，而 `reload` 依赖 `view`，所以「点完成」
     * 那一刻就把 `view` 定死了。而写库要**约 1.3 秒**才 resolve，
     * 用户在这期间切了视图，这次 reload 就会拿**过期的 view** 去查，
     * 把 `tasks` 覆盖成上一个视图的列表，而 `counts` 是现查的 ——
     * 表现就是「已完成 0 项 / 这里空着」但侧栏写着「已完成 1」。
     *
     * 真机探针（切视图后紧接着写库 resolve）：
     *   reload 开始 view=done     → load 回来 行数=1
     *   reload 开始 view=today    ← ★ 过期视图
     *   load 回来 view=today 行数=0  ← ★ 把正确结果覆盖掉了
     *   counts 回来 done=1
     *
     * 所以从 ref 里取**调用这一刻**的 view。
     */
    const viewRef = useRef(view);
    viewRef.current = view;

    /**
     * 代次号：只有最新一次 reload 的结果允许落地。
     *
     * `load` 与 `counts` 是两次独立的 SQL，各自要几十毫秒，而思源的属性写入
     * 对 SQL 有约 1.3 秒的可见延迟 —— 并发触发的两次 reload 很容易交错，
     * 让「列表」来自这一次、「数字」来自上一次。丢弃过期结果就没这个问题。
     */
    const genRef = useRef(0);

    const reload = useCallback(async () => {
        const gen = ++genRef.current;
        const v = viewRef.current;
        try {
            // 并行取，别串行 —— 串行会让两次查询相差约 100ms，
            // 这个窗口足够跨过「写入刚可见」那条边界。
            const [list, c] = await Promise.all([host.load(v, today), host.counts(today)]);
            if (gen !== genRef.current) {
                return; // 已经有更新的一次 reload 了，这份结果作废
            }
            setTasks(list);
            setCounts(c);
            setState("ready");
        } catch (e) {
            if (gen !== genRef.current) {
                return;
            }
            setError((e as Error)?.message ?? String(e));
            setState("error");
        }
    }, [host, today]);

    // 切视图要重新取（reload 现在不依赖 view 了，得显式触发）
    useEffect(() => { void reload(); }, [view, reload]);

    // 思源里改了东西（比如用快捷键改了属性）→ 视图跟上
    useEffect(() => {
        if (!host.subscribe) {
            return;
        }
        return host.subscribe(() => { void reload(); });
    }, [host, reload]);

    const onChanged = useCallback(() => { void reload(); }, [reload]);

    /**
     * 勾选完成 / 取消完成 —— **乐观更新**。
     *
     * 为什么不能等：思源的 `setBlockAttrs` 虽然 60ms 就返回，但 SQL 要
     * **约 1.3 秒**才读得到新值（真机实测 1302ms）。而 `toggleDone` 里用了
     * `setAttrsAndWait`（它就是为了「写完立刻重载会读到旧值」才存在的），
     * 于是整条链——写属性 → 等可见 → 可能有重复任务生成 → 重载——
     * resolve 之前界面纹丝不动，用户看到的就是「点了完成，过一会才动」。
     *
     * 所以这里先按本地算好的结果改界面，再去写库、再对账。
     * 写完之后 SQL 已经追上了，`reload()` 拿到的就是真值，不会回跳。
     */
    const onToggleDone = useCallback((task: ViewTask) => {
        // 用同一套定义算出它改之前 / 改之后各属于哪些清单，只动这几个数字。
        // 不这么算的话，要么等 1.3 秒，要么随便减一个把别的清单数字搞错。
        const before = smartListsOf(task, today);
        const after = smartListsOf({ ...task, done: task.done ? null : host.nowStamp() }, today);

        // ① 行立刻消失。「今天」里勾完就该没了；「已完成」里取消勾选同理。
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
        // ② 侧栏数字同步改，否则行没了数字还挂着
        setCounts((prev) => {
            const next = { ...prev };
            for (const id of before) {
                next[id] = Math.max(0, next[id] - 1);
            }
            for (const id of after) {
                next[id] = next[id] + 1;
            }
            return next;
        });
        // ③ 再去写库，写完对账
        void host.toggleDone(task.id).then(onChanged);
    }, [host, today, onChanged]);

    const smart = VIEW_TABS.filter((t) => t.group === "smart");
    const owned = VIEW_TABS.filter((t) => t.group === "view");
    const current = VIEW_TABS.find((t) => t.id === view);

    return (
        <div className="tf-tab" data-state={state} style={{ display: "flex", height: "100%", overflow: "hidden" }}>
            <nav style={{
                flex: "0 0 168px", borderRight: "1px solid var(--b3-border-color)",
                padding: "8px 6px", overflowY: "auto", fontSize: 13,
            }}>
                <div style={{ fontSize: 11, opacity: 0.5, padding: "4px 8px" }}>智能清单</div>
                {smart.map((t) => (
                    <NavItem key={t.id} label={t.label} count={counts[t.id as SmartListId]}
                        active={view === t.id} onClick={() => setView(t.id)} />
                ))}
                <div style={{ fontSize: 11, opacity: 0.5, padding: "10px 8px 4px" }}>视图</div>
                {owned.map((t) => (
                    <NavItem key={t.id} label={t.label} active={view === t.id} onClick={() => setView(t.id)} />
                ))}
            </nav>

            <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <header style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderBottom: "1px solid var(--b3-border-color)",
                }}>
                    <strong style={{ fontSize: 14 }}>{current?.label ?? view}</strong>
                    <span style={{ fontSize: 12, opacity: 0.5 }} data-tf-count={tasks.length}>
                        {state === "ready" ? `${tasks.length} 项` : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    <a style={{ fontSize: 12, opacity: 0.6, cursor: "pointer" }} onClick={() => void reload()}>刷新</a>
                </header>

                {state === "error" ? (
                    <div style={{ padding: 16, fontSize: 13, color: "var(--b3-theme-error)" }}>
                        加载失败：{error}
                    </div>
                ) : isSmartList(view) ? (
                    <TaskList view={view} tasks={tasks} today={today} host={host}
                        onChanged={onChanged} onToggleDone={onToggleDone} />
                ) : view === "board" ? (
                    <Board tasks={tasks} today={today} host={host} onChanged={onChanged} />
                ) : view === "calendar" ? (
                    <Calendar today={today} host={host} onChanged={onChanged} />
                ) : view === "matrix" ? (
                    <Matrix tasks={tasks} today={today} host={host} onChanged={onChanged} />
                ) : view === "stats" ? (
                    <Stats today={today} host={host} />
                ) : (
                    <div style={{ padding: 24, fontSize: 13, opacity: 0.55 }}>
                        「{current?.label}」还在做。先看智能清单。
                    </div>
                )}
            </main>
        </div>
    );
}

function isSmartList(v: ViewId): v is SmartListId {
    return (smartListIds() as string[]).includes(v);
}

function NavItem({ label, count, active, onClick }: {
    label: string; count?: number; active: boolean; onClick: () => void;
}) {
    return (
        <div
            data-tf-nav={label}
            onClick={onClick}
            style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                borderRadius: 4, cursor: "pointer",
                background: active ? "var(--b3-list-hover)" : "transparent",
                fontWeight: active ? 600 : 400,
            }}
        >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            {count !== undefined && count > 0 && (
                <span style={{ fontSize: 11, opacity: 0.5 }}>{count}</span>
            )}
        </div>
    );
}
