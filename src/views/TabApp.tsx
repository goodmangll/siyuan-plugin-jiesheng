/**
 * Tab 内的 React 根：左侧导航 + 主区。
 *
 * 画布用全屏 Tab 而不是 Dock —— 看板要横排多列、日历要 7 列网格，侧栏放不下。
 */

import { useCallback, useEffect, useState } from "react";
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

    const reload = useCallback(async () => {
        try {
            const list = await host.load(view, today);
            setTasks(list);
            setCounts(await host.counts(today));
            setState("ready");
        } catch (e) {
            setError((e as Error)?.message ?? String(e));
            setState("error");
        }
    }, [host, view, today]);

    useEffect(() => { void reload(); }, [reload]);

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
