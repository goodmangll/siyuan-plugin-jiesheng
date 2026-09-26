/**
 * 看板：一列一张清单（或一个优先级），卡片可拖到别的列。
 *
 * **拖拽 = 改属性**，这正是当初判断「QueryView 做不到」的那个核心交互：
 * 在 QueryView 里，看到一条任务想改它的清单，你得回编辑器、找到块、放上光标、再改属性。
 */

import { useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import type { Priority } from "../model/priority";
import { boardColumns, formatDue, type BoardGroupBy, type ViewTask } from "./model";
import type { ViewHost } from "./host";
import type { TaskStore } from "../store/taskStore";

export function Board({ tasks, today, host, store }: {
    tasks: ViewTask[];
    today: string;
    host: ViewHost;
    /** 写入走 store：先本地生效、再写库、落定后对账（见 store/taskStore.ts） */
    store: TaskStore;
}) {
    const [by, setBy] = useState<BoardGroupBy>("list");
    const [dragId, setDragId] = useState<string | null>(null);
    const [overKey, setOverKey] = useState<string | null>(null);
    const [knownLists, setKnownLists] = useState<string[]>([]);
    const groups = boardColumns(tasks, knownLists, by);

    useEffect(() => {
        void host.lists().then(setKnownLists).catch(() => setKnownLists([]));
    }, [host, tasks]);

    /**
     * 拖拽的 id **从 dataTransfer 里取**，而不是只靠 React state。
     *
     * 只靠 state 是脆的：state 更新要等下一次渲染，而 drop 读的是渲染时的闭包。
     * 真实拖拽分属不同 tick 所以碰巧能用，但一旦事件挤在同一个 tick 里就会读到 null。
     * dataTransfer 本来就是为传这个而存在的。
     */
    const drop = (key: string, fromTransfer?: string) => {
        const id = fromTransfer || dragId;
        setDragId(null);
        setOverKey(null);
        if (!id) {
            return;
        }
        const t = tasks.find((x) => x.id === id);
        if (!t) {
            return;
        }
        // ★ 乐观：卡片立刻落到新列，不等思源那约 2.5 秒的索引延迟
        if (by === "list") {
            void store.mutate(id, { ...t, list: key }, () => host.setList(id, key));
        } else {
            const pri = key as Priority;
            void store.mutate(id, { ...t, priority: pri }, () => host.setPriority(id, pri));
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                borderBottom: "1px solid var(--b3-border-color)", fontSize: 12,
            }}>
                <span style={{ opacity: 0.6 }}>按</span>
                {(["list", "priority"] as BoardGroupBy[]).map((m) => (
                    <a
                        key={m}
                        data-jie-board-by={m}
                        onClick={() => setBy(m)}
                        style={{ cursor: "pointer", fontWeight: by === m ? 600 : 400, opacity: by === m ? 1 : 0.6 }}
                    >
                        {m === "list" ? "清单" : "优先级"}
                    </a>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ opacity: 0.45 }}>拖卡片到另一列即可改{by === "list" ? "清单" : "优先级"}</span>
            </div>

            <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", gap: 10, padding: 12 }}
                data-jie-board={by}>
                {groups.map((g) => (
                    <div
                        key={g.key}
                        data-jie-col={g.key || "__none__"}
                        onDragOver={(e) => { e.preventDefault(); setOverKey(g.key); }}
                        onDragLeave={() => setOverKey((k) => (k === g.key ? null : k))}
                        onDrop={(e) => {
                            e.preventDefault();
                            drop(g.key, e.dataTransfer?.getData("text/plain") || undefined);
                        }}
                        style={{
                            flex: "0 0 240px", display: "flex", flexDirection: "column",
                            background: overKey === g.key ? "var(--b3-list-hover)" : "var(--b3-theme-background)",
                            border: "1px solid var(--b3-border-color)", borderRadius: 6, minHeight: 0,
                        }}
                    >
                        <div style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                            borderBottom: "1px solid var(--b3-border-color)", fontSize: 12, fontWeight: 600,
                        }}>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {g.title}
                            </span>
                            <span style={{ opacity: 0.5, fontWeight: 400 }}>{g.tasks.length}</span>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                            {g.tasks.map((t) => (
                                <Card key={t.id} task={t} today={today} host={host}
                                    dragging={dragId === t.id}
                                    onDragStart={(e) => {
                                        // 真实拖拽要给 dataTransfer 塞数据，否则浏览器可能不认为这是一次拖拽
                                        e.dataTransfer?.setData("text/plain", t.id);
                                        e.dataTransfer && (e.dataTransfer.effectAllowed = "move");
                                        setDragId(t.id);
                                    }}
                                    onDragEnd={() => { setDragId(null); setOverKey(null); }}
                                />
                            ))}
                            {g.tasks.length === 0 && (
                                <div style={{ padding: 12, textAlign: "center", opacity: 0.35, fontSize: 12 }}>
                                    拖到这里
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Card({ task, today, host, dragging, onDragStart, onDragEnd }: {
    task: ViewTask;
    today: string;
    host: ViewHost;
    dragging: boolean;
    onDragStart: (e: ReactDragEvent) => void;
    onDragEnd: () => void;
}) {
    const due = formatDue(task, today);
    const priColor: Record<string, string> = { high: "#e2554f", medium: "#e8a33d", low: "#3f8ae0", none: "transparent" };
    return (
        <div
            draggable
            data-jie-card={task.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={() => host.openDetail(task.id)}
            style={{
                background: "var(--b3-theme-surface)", border: "1px solid var(--b3-border-color)",
                borderRadius: 5, padding: "5px 7px", marginBottom: 6, cursor: "grab",
                opacity: dragging ? 0.4 : 1,
            }}
        >
            <div style={{ display: "flex", gap: 5 }}>
                <span style={{ flex: "0 0 auto", width: 3, borderRadius: 2, background: priColor[task.priority] }} />
                <span style={{ fontSize: 12.5, lineHeight: 1.45, wordBreak: "break-word" }}>{task.title}</span>
            </div>
            {(due || task.repeat || task.hasReminder) && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3, display: "flex", gap: 6 }}>
                    {due && <span style={task.overdue ? { color: "#e2554f" } : undefined}>{due}</span>}
                    {task.repeat && <span>↻</span>}
                    {task.hasReminder && <span>🔔</span>}
                </div>
            )}
        </div>
    );
}
