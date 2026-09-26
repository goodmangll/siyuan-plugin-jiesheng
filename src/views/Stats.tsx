/**
 * 统计：近 14 天的新建 / 完成趋势 + 未完成任务的分布。
 *
 * 图表用内联 SVG 手画 —— 不引图表库。这里要画的就是「N 根柱」，
 * 用不到库的 1%，却要多背一份升级负担。
 */

import { useEffect, useState } from "react";
import { barLayout, type SeriesPoint } from "./stats";
import type { ViewHost } from "./host";

const DAYS = 14;
const PRI_LABEL: Record<string, string> = { "1": "高", "2": "中", "3": "低", "0": "未设" };

export function Stats({ today, host }: { today: string; host: ViewHost }) {
    const [created, setCreated] = useState<SeriesPoint[]>([]);
    const [done, setDone] = useState<SeriesPoint[]>([]);
    const [byList, setByList] = useState<{ name: string; c: number }[]>([]);
    const [byPri, setByPri] = useState<{ p: string; c: number }[]>([]);
    const [err, setErr] = useState("");

    useEffect(() => {
        void (async () => {
            try {
                const t = await host.trends(today, DAYS);
                setCreated(t.created);
                setDone(t.done);
                const d = await host.distributions();
                setByList(d.byList);
                setByPri(d.byPriority);
            } catch (e) {
                setErr((e as Error)?.message ?? String(e));
            }
        })();
    }, [host, today]);

    if (err) {
        return <div style={{ padding: 16, fontSize: 13, color: "var(--b3-theme-error)" }}>统计加载失败：{err}</div>;
    }

    return (
        <div style={{ overflowY: "auto", padding: 16, fontSize: 13 }} data-jie-stats="1">
            <Section title={`近 ${DAYS} 天 · 完成`} total={done.reduce((n, x) => n + x.value, 0)}>
                <BarChart points={done} color="var(--b3-theme-primary)" />
            </Section>

            <Section title={`近 ${DAYS} 天 · 新建`} total={created.reduce((n, x) => n + x.value, 0)}>
                <BarChart points={created} color="#8ab4f8" />
            </Section>

            <Section title="未完成 · 按清单">
                <HBarChart
                    items={byList.slice(0, 12).map((x) => ({ label: x.name, value: x.c }))}
                    color="#e8a33d"
                />
            </Section>

            <Section title="未完成 · 按优先级">
                <HBarChart
                    items={byPri.map((x) => ({ label: PRI_LABEL[x.p] ?? x.p, value: x.c }))}
                    color="#7bbf7b"
                />
            </Section>
        </div>
    );
}

function Section({ title, total, children }: { title: string; total?: number; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 22 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {title}
                {total !== undefined && <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 8 }}>{total}</span>}
            </div>
            {children}
        </div>
    );
}

const H = 90;

function BarChart({ points, color }: { points: SeriesPoint[]; color: string }) {
    if (points.length === 0) {
        return <div style={{ opacity: 0.35 }}>没有数据</div>;
    }
    const W = 560;
    const bars = barLayout(points.map((p) => p.value), W, H);
    return (
        <div>
            <svg width={W} height={H + 16} style={{ maxWidth: "100%" }}>
                {bars.map((b, i) => (
                    <rect
                        key={i}
                        x={b.x + 4}
                        y={H - b.h}
                        width={Math.max(2, b.w - 8)}
                        height={b.h}
                        fill={color}
                        rx={2}
                    >
                        <title>{`${points[i].day}：${points[i].value}`}</title>
                    </rect>
                ))}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.5, width: W, maxWidth: "100%" }}>
                <span>{points[0].day.slice(4, 6)}-{points[0].day.slice(6, 8)}</span>
                <span>今天</span>
            </div>
        </div>
    );
}

function HBarChart({ items, color }: { items: { label: string; value: number }[]; color: string }) {
    if (items.length === 0) {
        return <div style={{ opacity: 0.35 }}>没有数据</div>;
    }
    const max = Math.max(...items.map((x) => x.value), 1);
    return (
        <div>
            {items.map((x) => (
                <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ flex: "0 0 7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.75 }}>
                        {x.label}
                    </span>
                    <span style={{ flex: 1, background: "var(--b3-border-color)", borderRadius: 3, height: 12 }}>
                        <span style={{
                            display: "block", height: "100%", borderRadius: 3,
                            width: `${(x.value / max) * 100}%`, background: color,
                        }} />
                    </span>
                    <span style={{ flex: "0 0 3em", textAlign: "right", opacity: 0.6 }}>{x.value}</span>
                </div>
            ))}
        </div>
    );
}
