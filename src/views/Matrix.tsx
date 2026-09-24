/**
 * 四象限（艾森豪威尔矩阵）。
 *
 * **拖拽只改优先级，不改日期** —— 这是刻意的：
 * 「紧急」是从截止日推导出来的，把一条任务从左拖到右如果顺手改了它的截止日，
 * 那是在替用户做他没说出口的决定。要么明说，要么不做。这里选「只改重要性」，
 * 并在界面上写清楚。
 */

import { useState } from "react";
import { matrixCell, formatDue, QUADRANT_TITLE, type Quadrant, type ViewTask } from "./model";
import type { ViewHost } from "./host";

const ORDER: Quadrant[] = ["q1", "q2", "q3", "q4"];
const HINT: Record<Quadrant, string> = {
    q1: "重要 + 3 天内到期",
    q2: "重要，但不急",
    q3: "3 天内到期，但优先级不高",
    q4: "既不重要也不急",
};

export function Matrix({ tasks, today, host, onChanged }: {
    tasks: ViewTask[];
    today: string;
    host: ViewHost;
    onChanged: () => void;
}) {
    const [dragId, setDragId] = useState<string | null>(null);
    const [over, setOver] = useState<Quadrant | null>(null);

    const buckets: Record<Quadrant, ViewTask[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const t of tasks) {
        buckets[matrixCell(t, today)].push(t);
    }

    const drop = (q: Quadrant, fromTransfer?: string) => {
        const id = fromTransfer || dragId;
        setDragId(null);
        setOver(null);
        if (!id) return;
        // 落进「重要」那两个格子 → 高优先级；落进另外两个 → 清掉优先级
        const important = q === "q1" || q === "q2";
        void host.setPriority(id, important ? "high" : "none").then(onChanged);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--b3-border-color)", fontSize: 11, opacity: 0.55 }}>
                纵轴 = 重要性（优先级高/中）· 横轴 = 紧急性（3 天内到期）·
                <strong style={{ marginLeft: 4 }}>拖动只改优先级，不动截止日</strong>
            </div>
            <div style={{
                flex: 1, minHeight: 0, display: "grid",
                gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 8, padding: 12,
            }} data-tf-matrix="1">
                {ORDER.map((q) => (
                    <div
                        key={q}
                        data-tf-quad={q}
                        onDragOver={(e) => { e.preventDefault(); setOver(q); }}
                        onDragLeave={() => setOver((v) => (v === q ? null : v))}
                        onDrop={(e) => { e.preventDefault(); drop(q, e.dataTransfer?.getData("text/plain") || undefined); }}
                        style={{
                            border: "1px solid var(--b3-border-color)", borderRadius: 6,
                            display: "flex", flexDirection: "column", minHeight: 0,
                            background: over === q ? "var(--b3-list-hover)" : undefined,
                        }}
                    >
                        <div style={{ padding: "5px 8px", borderBottom: "1px solid var(--b3-border-color)", fontSize: 12, fontWeight: 600 }}>
                            {QUADRANT_TITLE[q]}
                            <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 6 }}>{buckets[q].length}</span>
                            <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.45 }}>{HINT[q]}</div>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                            {buckets[q].map((t) => (
                                <div
                                    key={t.id}
                                    draggable
                                    data-tf-card={t.id}
                                    onDragStart={(e) => {
                                        e.dataTransfer?.setData("text/plain", t.id);
                                        setDragId(t.id);
                                    }}
                                    onDragEnd={() => { setDragId(null); setOver(null); }}
                                    onClick={() => host.openDetail(t.id)}
                                    style={{
                                        fontSize: 12, padding: "3px 6px", marginBottom: 4, borderRadius: 4,
                                        background: "var(--b3-theme-surface)", border: "1px solid var(--b3-border-color)",
                                        cursor: "grab", opacity: dragId === t.id ? 0.4 : 1,
                                        display: "flex", gap: 6,
                                    }}
                                >
                                    <span style={{ flex: 1, wordBreak: "break-word" }}>{t.title}</span>
                                    {t.day && (
                                        <span style={{ fontSize: 10, opacity: 0.55, whiteSpace: "nowrap" }}>
                                            {formatDue(t, today)}
                                        </span>
                                    )}
                                </div>
                            ))}
                            {buckets[q].length === 0 && (
                                <div style={{ textAlign: "center", opacity: 0.3, fontSize: 11, padding: 10 }}>拖到这里</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
