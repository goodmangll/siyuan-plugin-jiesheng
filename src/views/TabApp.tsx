/**
 * Tab 内的 React 根：左侧导航 + 主区。
 *
 * 画布用全屏 Tab 而不是 Dock —— 看板要横排多列、日历要 7 列网格，侧栏放不下。
 *
 * ## 这个组件现在很薄，是故意的
 *
 * 「快照 + 本地未落定的改动 + 派生 + 写入生命周期」全部收在 `store/taskStore.ts`。
 * 这里只做三件事：建 store、跟着 store 重渲染、把交互转成 store 的调用。
 *
 * 以前这套东西散在本文件里（11 个 state / ref 和渲染搅在一起），
 * 每加一个视图内的可写操作就得再补一段几乎一样的逻辑 ——
 * 看板、日历、四象限干脆就没补，于是每次拖拽都要等思源约 2.5 秒的索引延迟。
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { SmartListId } from "./query";
import { smartListIds } from "./query";
import type { ViewHost, ViewId } from "./host";
import { VIEW_TABS } from "./host";
import type { ViewTask } from "./model";
import { createTaskStore, type TaskStore } from "../store/taskStore";
import { TaskList } from "./TaskList";
import { Board } from "./Board";
import { Calendar } from "./Calendar";
import { Matrix } from "./Matrix";
import { Stats } from "./Stats";

export function TabApp({ host, initialView = "today" }: { host: ViewHost; initialView?: ViewId }) {
    const today = host.today();

    /** store 只建一次；host 变了才重建 */
    const storeRef = useRef<{ store: TaskStore; host: ViewHost } | null>(null);
    if (storeRef.current === null || storeRef.current.host !== host) {
        const store = createTaskStore({
            today,
            load: (view, t) => host.load(view, t),
            counts: (t) => host.counts(t),
            now: () => host.nowStamp(),
            onMutateError: (e) => host.toast?.((e?.message || "操作失败").slice(0, 120)),
        });
        store.setView(initialView);
        void store.refresh();
        storeRef.current = { store, host };
    }
    const store = storeRef.current.store;

    // 外部（思源里改了东西）→ 交给 store 的防抖刷新
    useEffect(() => {
        if (!host.subscribe) {
            return;
        }
        return host.subscribe(() => store.pokeKernelChange());
    }, [host, store]);

    // 订阅 store：它变了就重渲染。
    // 用版本号当快照 —— items() 每次都是新数组，直接当快照会无限重渲染。
    useSyncExternalStore(
        (fn) => store.subscribe(fn),
        () => store.version(),
    );

    const view = store.getView();
    const tasks = store.items();
    const counts = store.counts();
    const status = store.status();

    const onToggleDone = useMemo(() => (task: ViewTask) => {
        // 本地先算好「改完之后长什么样」—— 这一个对象同时决定
        // 界面立刻变成什么、以及这次改动影响哪些清单/数字
        const after = { ...task, done: task.done ? null : host.nowStamp() };
        void store.mutate(task.id, after, () => host.toggleDone(task.id));
    }, [store, host]);

    const smart = VIEW_TABS.filter((t) => t.group === "smart");
    const owned = VIEW_TABS.filter((t) => t.group === "view");
    const current = VIEW_TABS.find((t) => t.id === view);

    return (
        <div className="tf-tab" data-state={status.state} style={{ display: "flex", height: "100%", overflow: "hidden" }}>
            <nav style={{
                flex: "0 0 168px", borderRight: "1px solid var(--b3-border-color)",
                padding: "8px 6px", overflowY: "auto", fontSize: 13,
            }}>
                <div style={{ fontSize: 11, opacity: 0.5, padding: "4px 8px" }}>智能清单</div>
                {smart.map((t) => (
                    <NavItem key={t.id} label={t.label} count={counts[t.id as SmartListId]}
                        active={view === t.id} onClick={() => store.setView(t.id)} />
                ))}
                <div style={{ fontSize: 11, opacity: 0.5, padding: "10px 8px 4px" }}>视图</div>
                {owned.map((t) => (
                    <NavItem key={t.id} label={t.label} active={view === t.id} onClick={() => store.setView(t.id)} />
                ))}
            </nav>

            <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <header style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderBottom: "1px solid var(--b3-border-color)",
                }}>
                    <strong style={{ fontSize: 14 }}>{current?.label ?? view}</strong>
                    {/*
                      * 表头数字与列表**同一个数据源**（都来自 store），
                      * 不会再出现「已完成 0 项」而侧栏写着 1。
                      */}
                    <span style={{ fontSize: 12, opacity: 0.5 }} data-tf-count={tasks.length}>
                        {status.state === "ready" ? `${tasks.length} 项` : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    <a style={{ fontSize: 12, opacity: 0.6, cursor: "pointer" }}
                        onClick={() => void store.refresh()}>刷新</a>
                </header>

                {status.state === "error" ? (
                    <div style={{ padding: 16, fontSize: 13, color: "var(--b3-theme-error)" }}>
                        加载失败：{status.error}
                    </div>
                ) : isSmartList(view) ? (
                    <TaskList view={view} tasks={tasks} today={today} host={host}
                        onChanged={() => void store.refresh()} onToggleDone={onToggleDone} />
                ) : view === "board" ? (
                    <Board tasks={tasks} today={today} host={host} store={store} />
                ) : view === "calendar" ? (
                    <Calendar today={today} host={host} onChanged={() => void store.refresh()} />
                ) : view === "matrix" ? (
                    <Matrix tasks={tasks} today={today} host={host} store={store} />
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
