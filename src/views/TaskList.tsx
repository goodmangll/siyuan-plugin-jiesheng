/**
 * 任务列表视图 —— 今天 / 明天 / 未来 7 天 / 收件箱 / 全部 共用这一个。
 *
 * 这些智能清单的差别**只在于 SQL 的日期条件**（见 views/query.ts），
 * 展示与交互完全一致，所以不需要五份组件。
 */

import { useState } from "react";
import type { ViewTask } from "./model";
import type { ViewHost, ViewId } from "./host";
import { TaskRow } from "./TaskRow";

export function TaskList({ view, tasks, today, host, onChanged }: {
    view: ViewId;
    tasks: ViewTask[];
    today: string;
    host: ViewHost;
    onChanged: () => void;
}) {
    const [draft, setDraft] = useState("");
    // 「收件箱」新建的任务不带日期；其它清单新建时按清单语义带上默认日期
    const dueForNew = view === "today" ? today
        : view === "tomorrow" ? addDaysStr(today, 1)
            : null;

    const submit = () => {
        const title = draft.trim();
        if (!title) {
            return;
        }
        setDraft("");
        void host.createTask(title, dueForNew).then(onChanged);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 8px", borderBottom: "1px solid var(--b3-border-color)",
            }}>
                <span style={{ opacity: 0.5 }}>+</span>
                <input
                    className="b3-text-field"
                    data-tf-new="1"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder="回车新建一条任务"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }} data-tf-list={view}>
                {tasks.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", opacity: 0.4, fontSize: 13 }}>
                        这里空着
                    </div>
                ) : (
                    tasks.map((t) => (
                        <TaskRow key={t.id} task={t} today={today} host={host} onChanged={onChanged} />
                    ))
                )}
            </div>
        </div>
    );
}

/** `yyyyMMdd` 加天数（列表新建任务用，容忍非法输入） */
function addDaysStr(day: string, n: number): string {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(4, 6));
    const d = Number(day.slice(6, 8));
    const t = new Date(y, m - 1, d + n);
    const p = (v: number) => String(v).padStart(2, "0");
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}`;
}
