/**
 * Tab 内的 React 根：左侧导航 + 主区。
 *
 * 画布用全屏 Tab 而不是 Dock —— 看板要横排多列、日历要 7 列网格，侧栏放不下。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SmartListId } from "./query";
import { applyLocalDone, smartListIds, smartListsOf } from "./query";
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

    /**
     * 本地已知、但 SQL 可能还没追上的完成态。
     *
     * 写入落定前（约 1.3 秒），**任何 SQL 快照都比本地知道的旧** ——
     * `ws-main` 在索引完成之前就通知视图刷新，会拿旧快照把乐观更新冲掉。
     * 所以这段时间的渲染以本地为准；写入落定后 reload 落地时清空。
     *
     * 没有它的话，切到「已完成」要等 1.1 秒才出内容
     *（因为 reload 要等写入落定），那 1.1 秒里主区写着「0 项」而侧栏是 1。
     */
    /**
     * ⚠️ 用 ref 而不是 state：`reload` 被 `useCallback([host, today])` 记忆化，
     * 它闭包里的 state 永远是**首次渲染**的那份。真机探针踩到过 ——
     * 日志里「覆盖层=N」恒为 0，于是清理逻辑等于没执行。
     * ref 在任何闭包里读到的都是最新值。
     */
    const localDoneRef = useRef<Map<string, ViewTask>>(new Map());
    /** 覆盖层变化时强制重渲染（它自己是 ref，React 不知道它变了） */
    const [, bumpOverlay] = useState(0);

    /**
     * 写库**已落定**的任务 id。
     *
     * 覆盖层不能在「任意一次 reload 落地」时清空 —— 真机踩到：
     * **点击之前就发起的那次 reload**，它 await 的是**旧的** writeChain
     *（那次链早已 resolve），于是立刻取到「点击前」的快照，
     * 落地时把乐观结果覆盖回去 —— 界面整个回退。
     * 代次号挡不住它（它就是顺序上最新的那一次）。
     *
     * 只有当**这次写入自己**落定了，SQL 才一定追得上，那条覆盖才可以撤。
     */
    const resolvedRef = useRef<Set<string>>(new Set());

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
            // 只撤掉「写入已落定」的那些覆盖 —— 其余的是本地比 SQL 新，
            // 撤了就会回退（见 resolvedRef 的说明）
            const done = resolvedRef.current;
            if (done.size) {
                resolvedRef.current = new Set();
                for (const id of done) {
                    localDoneRef.current.delete(id);
                }
                bumpOverlay((n) => n + 1);
            }
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

    /** 真正拿去渲染的行：SQL 的结果叠上本地已知的完成态 */
    const shown = applyLocalDone(tasks, view, today, localDoneRef.current);

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
        // ③ 登记本地覆盖：写入落定前，SQL 都会说它「还没完成」
        const optimistic = { ...task, done: task.done ? null : host.nowStamp() };
        localDoneRef.current.set(task.id, optimistic);
        bumpOverlay((n) => n + 1);
        // ④ 再去写库。**落定之后**才允许撤掉覆盖（那时 SQL 一定追上了）
        void host.toggleDone(task.id).then(() => {
            resolvedRef.current.add(task.id);
            onChanged();
        });
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
                    {/*
                      * 这里的数字必须和列表用**同一个数据源**（`shown`）。
                      * 曾经写成 `tasks.length` —— 那是 SQL 的结果，而列表渲染的是
                      * 叠加本地完成态之后的 `shown`。两者在这 1.3 秒里会不一致，
                      * 表现就是「已完成 0 项 / 这里空着」而侧栏写着 1（真机截图）。
                      */}
                    <span style={{ fontSize: 12, opacity: 0.5 }} data-tf-count={shown.length}>
                        {state === "ready" ? `${shown.length} 项` : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    <a style={{ fontSize: 12, opacity: 0.6, cursor: "pointer" }} onClick={() => void reload()}>刷新</a>
                </header>

                {state === "error" ? (
                    <div style={{ padding: 16, fontSize: 13, color: "var(--b3-theme-error)" }}>
                        加载失败：{error}
                    </div>
                ) : isSmartList(view) ? (
                    <TaskList view={view} tasks={shown} today={today} host={host}
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
