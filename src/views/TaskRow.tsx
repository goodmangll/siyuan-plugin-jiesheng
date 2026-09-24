/**
 * 一条任务行。
 *
 * 只在视图内复用 —— 详情编辑仍然是 Dock 面板（那是已经做好并验证过的东西）。
 * 这里负责"看一眼就知道要紧不要紧"：左侧色条=优先级，逾期加红。
 */

import type { ViewTask } from "./model";
import { formatDue } from "./model";
import type { ViewHost } from "./host";

const PRI_COLOR: Record<string, string> = {
    high: "#e2554f",
    medium: "#e8a33d",
    low: "#3f8ae0",
    none: "transparent",
};

const PRI_TITLE: Record<string, string> = { high: "高", medium: "中", low: "低", none: "无" };

export function TaskRow({ task, today, host, onChanged, depth = 1, childCount = 0, collapsed = false, onToggleCollapse }: {
    task: ViewTask;
    today: string;
    host: ViewHost;
    onChanged: () => void;
    /** 1 = 顶层任务，2 = 子任务…（子任务=子文档，层级来自文档路径） */
    depth?: number;
    /** 直属子任务数 */
    childCount?: number;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}) {
    const dueText = formatDue(task, today);
    return (
        <div
            className="tf-row"
            data-tf-task={task.id}
            data-overdue={task.overdue ? "1" : undefined}
            style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                // 子任务缩进 —— 层级来自文档路径（位置即关系）
                padding: "6px 8px", paddingLeft: 8 + (depth - 1) * 18,
                borderBottom: "1px solid var(--b3-border-color)",
                cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--b3-list-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            onClick={() => host.openDetail(task.id)}
        >
            {/* 展开/折叠子任务 */}
            {childCount > 0 ? (
                <a
                    data-tf-fold={task.id}
                    title={collapsed ? `展开 ${childCount} 个子任务` : "折叠子任务"}
                    style={{ flex: "0 0 auto", width: 12, marginTop: 2, fontSize: 10, opacity: 0.55, cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
                >
                    {collapsed ? "▸" : "▾"}
                </a>
            ) : (
                <span style={{ flex: "0 0 auto", width: 12 }} />
            )}
            <span
                title={`优先级 ${PRI_TITLE[task.priority]}`}
                style={{
                    flex: "0 0 auto", width: 3, alignSelf: "stretch", borderRadius: 2,
                    background: PRI_COLOR[task.priority], marginTop: 1,
                }}
            />
            {/* ★ 任务=文档：文档没有复选框，这个勾选框是**我们自己画的**，
                它写的是 custom-done（不是思源原生的 [X]） */}
            <input
                type="checkbox"
                data-tf-check={task.id}
                checked={task.done !== null}
                title={task.done ? `完成于 ${task.done}` : "标记完成"}
                style={{ flex: "0 0 auto", marginTop: 3, cursor: "pointer" }}
                onClick={(e) => e.stopPropagation()}
                onChange={() => { void host.toggleDone(task.id).then(onChanged); }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
                    {task.pinned && <span title="已置顶" style={{ marginRight: 4 }}>📌</span>}
                    {task.title || <span style={{ opacity: 0.4 }}>（无标题）</span>}
                </div>
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {dueText && (
                        <span style={task.overdue ? { color: "#e2554f" } : undefined}>{dueText}</span>
                    )}
                    {task.list && <span>@{task.list}</span>}
                    {childCount > 0 && <span title="直属子任务数">⤷ {childCount}</span>}
                    {task.repeat && <span title={task.repeat}>↻</span>}
                    {task.hasReminder && <span title="有提醒">🔔</span>}
                </div>
            </div>
            <a
                title="在文档里定位"
                style={{ flex: "0 0 auto", fontSize: 11, opacity: 0.45, alignSelf: "center" }}
                onClick={(e) => { e.stopPropagation(); host.openBlock(task.id); }}
            >
                定位
            </a>
        </div>
    );
}
