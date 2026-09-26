/**
 * 日历：月网格 + 拖任务到别的日子改期。
 *
 * 「拖一下就改期」是同类产品日历里最常用的动作，也是最值得从 QueryView 手里收回来的 ——
 * QueryView 里改个日期要回编辑器找到块、放上光标、再按快捷键。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ViewTask } from "./model";
import { formatDue, withDue } from "./model";
import { monthGrid, monthLabel, shiftMonth, weekdayHeaders } from "./calendar";
import type { ViewHost } from "./host";
import type { TaskStore } from "../store/taskStore";

const CELL_TASK_LIMIT = 3;

export function Calendar({ today, host, store }: {
    today: string;
    host: ViewHost;
    /** 写入走 store：先本地生效、再写库、落定后对账（见 store/taskStore.ts） */
    store: TaskStore;
}) {
    const [anchor, setAnchor] = useState(today);
    const [tasks, setTasks] = useState<ViewTask[]>([]);
    const [dragId, setDragId] = useState<string | null>(null);
    const [overDay, setOverDay] = useState<string | null>(null);
    const [picked, setPicked] = useState<string | null>(null);

    const grid = useMemo(() => monthGrid(anchor), [anchor]);
    const range = useMemo(() => {
        const flat = grid.flat();
        const first = flat[0].day;
        const last = flat[flat.length - 1].day;
        // 止不含：末格 +1 天
        const y = Number(last.slice(0, 4)), m = Number(last.slice(4, 6)), d = Number(last.slice(6, 8)) + 1;
        const p = (n: number) => String(n).padStart(2, "0");
        const t = new Date(y, m - 1, d);
        return { from: first, to: `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}` };
    }, [grid]);

    // 日历用的是**自己这个月**的数据（loadRange），和 TabApp 那份不是一回事。
    // 所以两份都要处理：自己这份叠加 store 的未落定改动（applyPending），
    // 改完也让 store 去对账（mutate 内部会）。
    const reload = useCallback(async () => {
        try {
            setTasks(await host.loadRange(range.from, range.to));
        } catch {
            setTasks([]);
        }
    }, [host, range.from, range.to]);

    // ★ 跟着 store 重取自己这个月。
    //   少了这句会有一个很隐蔽的回退：拖完日期 → 格子立刻换过去（applyPending）→
    //   写入落定、store 撤掉 pending → 而自己这份 loadRange 数据从没重取过，
    //   于是格子又跳回旧日子。只靠 applyPending 只能撑到落定那一刻。
    const storeVersion = useSyncExternalStore(
        (fn) => store.subscribe(fn),
        () => store.version(),
    );
    useEffect(() => { void reload(); }, [reload, storeVersion]);

    /** 叠加未落定的改动后再分格 —— 否则拖完格子还显示在原地 */
    const shown = store.applyPending(tasks);

    const byDay = useMemo(() => {
        const m = new Map<string, ViewTask[]>();
        for (const t of shown) {
            if (!t.day) continue;
            const arr = m.get(t.day);
            arr ? arr.push(t) : m.set(t.day, [t]);
        }
        return m;
    }, [shown]);

    const drop = (day: string, fromTransfer?: string) => {
        const id = fromTransfer || dragId;
        setDragId(null);
        setOverDay(null);
        if (!id) return;
        const t = tasks.find((x) => x.id === id);
        if (!t) return;
        // ★ 乐观：格子立刻换到新日子，不等思源那约 2.5 秒的索引延迟。
        //   `withDue` 会连 day / isToday / overdue 一起重算 —— 只写 due 的话
        //   日历还按旧日子分格（真机踩过）。
        void store.mutate(id, withDue(t, day, today), () => host.setDue(id, day));
    };

    const pickedTasks = picked ? (byDay.get(picked) ?? []) : [];

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid var(--b3-border-color)" }}>
                <a data-tf-cal="prev" style={{ cursor: "pointer" }} onClick={() => setAnchor(shiftMonth(anchor, -1))}>‹</a>
                <strong data-tf-cal="label" style={{ fontSize: 13 }}>{monthLabel(anchor)}</strong>
                <a data-tf-cal="next" style={{ cursor: "pointer" }} onClick={() => setAnchor(shiftMonth(anchor, 1))}>›</a>
                <a data-tf-cal="today" style={{ cursor: "pointer", fontSize: 12, opacity: 0.7 }} onClick={() => setAnchor(today)}>回到今天</a>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, opacity: 0.45 }}>拖任务到别的日子 = 改期</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontSize: 11, opacity: 0.5, padding: "4px 0", borderBottom: "1px solid var(--b3-border-color)" }}>
                {weekdayHeaders().map((w) => <div key={w} style={{ textAlign: "center" }}>{w}</div>)}
            </div>

            <div style={{ display: "grid", gridTemplateRows: "repeat(6, 1fr)", flex: 1, minHeight: 0 }} data-tf-cal-grid="1">
                {grid.map((row, ri) => (
                    <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", minHeight: 0 }}>
                        {row.map((cell) => {
                            const list = byDay.get(cell.day) ?? [];
                            const isToday = cell.day === today;
                            return (
                                <div
                                    key={cell.day}
                                    data-tf-day={cell.day}
                                    onDragOver={(e) => { e.preventDefault(); setOverDay(cell.day); }}
                                    onDragLeave={() => setOverDay((d) => (d === cell.day ? null : d))}
                                    onDrop={(e) => { e.preventDefault(); drop(cell.day, e.dataTransfer?.getData("text/plain") || undefined); }}
                                    onClick={() => setPicked(cell.day)}
                                    style={{
                                        borderRight: "1px solid var(--b3-border-color)",
                                        borderBottom: "1px solid var(--b3-border-color)",
                                        padding: 3, overflow: "hidden", minHeight: 0, cursor: "pointer",
                                        background: overDay === cell.day ? "var(--b3-list-hover)" : undefined,
                                        opacity: cell.inMonth ? 1 : 0.4,
                                    }}
                                >
                                    <div style={{
                                        fontSize: 11, textAlign: "right",
                                        fontWeight: isToday ? 700 : 400,
                                        color: isToday ? "var(--b3-theme-primary)" : undefined,
                                    }}>
                                        {Number(cell.day.slice(6, 8))}
                                    </div>
                                    {list.slice(0, CELL_TASK_LIMIT).map((t) => (
                                        <div
                                            key={t.id}
                                            draggable
                                            data-tf-card={t.id}
                                            onDragStart={(e) => {
                                                e.dataTransfer?.setData("text/plain", t.id);
                                                setDragId(t.id);
                                            }}
                                            onDragEnd={() => { setDragId(null); setOverDay(null); }}
                                            onClick={(e) => { e.stopPropagation(); host.openDetail(t.id); }}
                                            style={{
                                                fontSize: 11, lineHeight: 1.35, padding: "1px 3px", marginTop: 1,
                                                borderRadius: 3, cursor: "grab",
                                                background: t.priority === "high" ? "rgba(226,85,79,.18)" : "var(--b3-list-hover)",
                                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                                opacity: dragId === t.id ? 0.4 : 1,
                                            }}
                                        >
                                            {t.title || "（无标题）"}
                                        </div>
                                    ))}
                                    {list.length > CELL_TASK_LIMIT && (
                                        <div style={{ fontSize: 10, opacity: 0.5, paddingLeft: 3 }}>
                                            还有 {list.length - CELL_TASK_LIMIT} 条
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            {picked && (
                <div style={{ borderTop: "1px solid var(--b3-border-color)", maxHeight: 160, overflowY: "auto", padding: "6px 12px" }}
                    data-tf-cal-day={picked}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        {picked} · {pickedTasks.length} 项
                    </div>
                    {pickedTasks.map((t) => (
                        <div key={t.id} style={{ fontSize: 12, padding: "2px 0", cursor: "pointer" }}
                            onClick={() => host.openDetail(t.id)}>
                            <span style={{ opacity: 0.5, marginRight: 6 }}>{formatDue(t, today) === "" ? "" : ""}</span>
                            {t.title}
                        </div>
                    ))}
                    {pickedTasks.length === 0 && <div style={{ fontSize: 12, opacity: 0.4 }}>这天没有任务</div>}
                </div>
            )}
        </div>
    );
}
