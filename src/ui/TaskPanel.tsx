/**
 * 可编辑的任务面板。
 *
 * 这里只做渲染与接线：所有判断都在 `panelActions.ts`（纯函数，已单测）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ATTR, toMeta } from "../model/attrs";
import { isAllDay } from "../model/date";
import { priorityLabel, type Priority } from "../model/priority";
import { PRESETS } from "../model/repeat";
import type { PresetId } from "../model/repeat";
import {
    REMIND_PRESETS, patchAbandon, patchDue, patchList, patchPriority, patchRange,
    patchRemindAdd, patchRemindClear, patchRemindPreset, patchRemindRemove,
    patchAllDay, patchRepeatClear, patchRepeatCount, patchRepeatExdateAdd, patchRepeatExdateRemove,
    patchRepeatFrom, patchRepeatPreset, patchRepeatUntil, repeatExdates, repeatRuleUntil,
    subtaskMarkdown, type Patch,
} from "./panelActions";

export interface TaskPanelHost {
    /** 当前聚焦的任务块（调用方负责把光标块归一化到任务项） */
    currentBlockId(): Promise<string | null>;
    readAttrs(id: string): Promise<Record<string, string>>;
    writeAttrs(id: string, patch: Patch): Promise<void>;
    /** 在任务项内部追加一个子任务 */
    appendSubtask(id: string, markdown: string): Promise<void>;
    /** 读任务标题（kramdown 首行） */
    title(id: string): Promise<string>;
    /** 跳到该块（打开所在文档并定位） */
    openBlock(id: string): void;
    /** 删除块（进回收站） */
    removeBlock(id: string): Promise<void>;
    /**
     * 取走一次「打开面板后该聚焦哪个字段」的请求，取过即清。
     * 用「取」而不是「读」是为了保证只生效一次 —— 否则面板每次重渲染都会抢焦点。
     */
    takeFocus(): string | null;
    /** 完成状态 */
    toggleDone(id: string): Promise<void>;
    isDone(id: string): Promise<boolean>;
    toast(message: string): void;
    now(): Date;
}

const btn: React.CSSProperties = { padding: "1px 8px", fontSize: "12px", marginRight: 4, marginBottom: 4 };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", marginBottom: 6 };
const labelStyle: React.CSSProperties = { width: "3.5em", opacity: 0.6, flex: "0 0 auto" };
const fieldStyle: React.CSSProperties = { fontSize: "12px", padding: "1px 4px" };

function toInputValue(v: string | undefined): string {
    if (!v) return "";
    return v.length >= 12 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}`
        : `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}
function fromInputValue(v: string): string {
    if (!v) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
    return m ? m[1] + m[2] + m[3] + (m[4] ? m[4] + m[5] : "") : "";
}
/** 输入框里的「全天」勾选状态：没有 due 也当作全天（默认新任务就是全天） */
function isAllDayValue(v: string | undefined): boolean {
    return !v || isAllDay(v);
}
function pretty(v: string | undefined): string {
    if (!v) return "—";
    const d = v.length >= 12
        ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)} ${v.slice(8, 10)}:${v.slice(10, 12)}`
        : `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return d;
}

export function TaskPanel({ host, onReady }: { host: TaskPanelHost; onReady?: (refresh: () => void) => void }) {
    const [blockId, setBlockId] = useState<string | null>(null);
    const [attrs, setAttrs] = useState<Record<string, string>>({});
    const [done, setDone] = useState(false);
    const [title, setTitle] = useState("");
    const [subtask, setSubtask] = useState("");
    const [repeatId, setRepeatId] = useState<PresetId>("daily");
    const [customAt, setCustomAt] = useState("");
    const [countText, setCountText] = useState("");
    const [exdate, setExdate] = useState("");
    // 属性读完了没有 —— 面板的「就绪」信号。
    // 没有它，测试（和我自己跑真机验收时）只能靠 sleep 猜时机，
    // 表现就是「第一次点没生效、第二次才生效」这种忽灵忽不灵的假象。
    const [ready, setReady] = useState(false);
    // 每次 reload 都 +1：让下面那个焦点 effect 每回都重跑一遍。
    // 否则「面板已经开着、再按一次 ⌥⇧D」不会重新聚焦（effect 的依赖没变）
    const [focusTick, setFocusTick] = useState(0);
    const dueRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async (id?: string | null) => {
        const target = id ?? await host.currentBlockId();
        setBlockId(target);
        if (!target) {
            setAttrs({});
            setTitle("");
            setReady(true);
            return;
        }
        try {
            setAttrs(await host.readAttrs(target));
            setDone(await host.isDone(target));
            setTitle(await host.title(target));
        } catch {
            setAttrs({});
        }
        setReady(true);
        setFocusTick((n) => n + 1);
    }, [host]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // 把「重新读一次」暴露给插件，让它能在光标移动 / 命令触发时调用
    useEffect(() => {
        onReady?.(() => {
            void reload();
        });
    }, [onReady, reload]);

    // 属性就绪后再处理焦点请求：早了会聚焦到一个还没渲染出来的输入框
    useEffect(() => {
        if (!ready || !blockId || host.takeFocus() !== "due") {
            return;
        }
        // Dock 是**展开动画**中挂上来的：effect 跑的那一刻输入框已经存在，
        // 但 offsetParent 还是 null（不可见），此时 focus() 是**空操作**。
        // 真机实测：t=0 时 offsetParent=false，t≈560ms 才可见 —— 一次 focus 根本不够。
        let tries = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const attempt = () => {
            const el = dueRef.current;
            if (!el) {
                return;
            }
            el.focus();
            if (document.activeElement === el) {
                return; // 真的聚焦上了
            }
            if (tries++ < 20) {
                timer = setTimeout(attempt, 50);
            }
        };
        attempt();
        return () => { if (timer) { clearTimeout(timer); } };
    }, [ready, blockId, focusTick, host]);

    const apply = useCallback(async (patch: Patch | null, failMessage?: string) => {
        if (patch === null) {
            if (failMessage) host.toast(failMessage);
            return;
        }
        if (!blockId) {
            host.toast("任务流：请把光标放在一个任务上");
            return;
        }
        try {
            await host.writeAttrs(blockId, patch);
            setAttrs((prev) => ({ ...prev, ...patch }));
        } catch (e) {
            host.toast("任务流：" + ((e as Error).message || "写入失败"));
        }
    }, [blockId, host]);

    const meta = toMeta(attrs);

    if (!blockId) {
        return (
            <div className="task-flow-panel" data-state="empty" style={{ padding: 12, fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>任务</div>
                <div style={{ opacity: 0.6 }}>把光标放到一个任务上，然后按 Alt+Shift+D。</div>
            </div>
        );
    }

    return (
        <div className="task-flow-panel" data-state={ready ? "ready" : "loading"} style={{ padding: "10px 12px", fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {title || "任务"}
                </span>
                <a
                    style={{ fontSize: 12, opacity: 0.6, cursor: "pointer", flex: "0 0 auto" }}
                    onClick={() => host.openBlock(blockId)}
                >
                    跳转到块
                </a>
            </div>

            {/* 日期 */}
            <div style={rowStyle}>
                <span style={labelStyle}>日期</span>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchDue(attrs, "today", host.now()))}>今天</button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchDue(attrs, "tomorrow", host.now()))}>明天</button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchDue(attrs, "dayAfter", host.now()))}>后天</button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchDue(attrs, "clear", host.now()))}>清除</button>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle} />
                <span style={{ opacity: 0.6, marginRight: 6 }}>截止</span>
                <input
                    ref={dueRef} data-tf="due"
                    key={`due-${blockId}-${attrs[ATTR.due] ?? ""}`}
                    className="b3-text-field" style={fieldStyle} defaultValue={toInputValue(attrs[ATTR.due])}
                    placeholder="yyyy-MM-dd 或 yyyy-MM-ddTHH:mm"
                    onBlur={(e) => void apply(patchRange(attrs, attrs[ATTR.start] ?? "", fromInputValue(e.target.value)))}
                />
                <label style={{ marginLeft: 8, fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                    <input
                        type="checkbox" style={{ verticalAlign: "middle", marginRight: 3 }}
                        checked={!attrs[ATTR.due] || isAllDayValue(attrs[ATTR.due])}
                        onChange={(e) => void apply(patchAllDay(attrs, e.target.checked))}
                    />全天
                </label>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle} />
                <span style={{ opacity: 0.6, marginRight: 6 }}>开始</span>
                <input
                    key={`start-${blockId}-${attrs[ATTR.start] ?? ""}`}
                    className="b3-text-field" style={fieldStyle} defaultValue={toInputValue(attrs[ATTR.start])}
                    placeholder="yyyy-MM-dd 或 yyyy-MM-ddTHH:mm"
                    onBlur={(e) => void apply(patchRange(attrs, fromInputValue(e.target.value), attrs[ATTR.due] ?? ""))}
                />
            </div>

            {/* 优先级 */}
            <div style={rowStyle}>
                <span style={labelStyle}>优先级</span>
                {(["high", "medium", "low", "none"] as Priority[]).map((p) => (
                    <button
                        key={p}
                        className={`b3-button b3-button--outline${meta.pri === p ? " b3-button--cancel" : ""}`}
                        style={btn}
                        onClick={() => void apply(patchPriority(p))}
                    >
                        {priorityLabel(p)}
                    </button>
                ))}
            </div>

            {/* 提醒 */}
            <div style={rowStyle}>
                <span style={labelStyle}>提醒</span>
                <select
                    className="b3-select" style={fieldStyle} value=""
                    onChange={(e) => {
                        const v = e.target.value;
                        e.target.value = "";
                        if (v) void apply(patchRemindPreset(attrs, v), "请先设置截止日期，提醒是相对它计算的");
                    }}
                >
                    <option value="">+ 预设</option>
                    {REMIND_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input
                    className="b3-text-field" style={{ ...fieldStyle, width: "8.5em", marginLeft: 4 }}
                    placeholder="yyyyMMddHHmm" value={customAt}
                    onChange={(e) => setCustomAt(e.target.value)}
                />
                <button
                    className="b3-button b3-button--outline" style={{ ...btn, marginLeft: 4 }}
                    onClick={() => { void apply(patchRemindAdd(attrs, customAt), "时间格式不对"); setCustomAt(""); }}
                >
                  加
                </button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchRemindClear())}>清空</button>
            </div>
            {meta.remind.length > 0 && (
                <div style={{ marginLeft: "3.5em", marginBottom: 6 }}>
                    {meta.remind.map((r) => (
                        <div key={r} style={{ fontSize: 12 }}>
                            <span style={{ opacity: 0.7 }}>{pretty(r)}</span>
                            <a style={{ marginLeft: 6, cursor: "pointer", opacity: 0.6 }} onClick={() => void apply(patchRemindRemove(attrs, r))}>删除</a>
                        </div>
                    ))}
                </div>
            )}

            {/* 重复 */}
            <div style={rowStyle}>
                <span style={labelStyle}>重复</span>
                <select className="b3-select" style={fieldStyle} value={repeatId} onChange={(e) => setRepeatId(e.target.value as PresetId)}>
                    {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button className="b3-button b3-button--outline" style={{ ...btn, marginLeft: 4 }} onClick={() => void apply(patchRepeatPreset(attrs, repeatId, host.now()))}>设置</button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchRepeatClear())}>清除</button>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle} />
                <span style={{ opacity: 0.6, marginRight: 6 }}>结束于</span>
                <input
                    className="b3-text-field" style={fieldStyle} placeholder="yyyy-MM-dd 或留空 = 一直"
                    defaultValue={toInputValue(repeatRuleUntil(attrs))}
                    key={`until-${blockId}-${repeatRuleUntil(attrs) ?? ""}`}
                    onBlur={(e) => {
                        const v = fromInputValue(e.target.value);
                        void apply(patchRepeatUntil(attrs, v || null), "请先设置重复规则");
                    }}
                />
            </div>
            <div style={rowStyle}>
                <span style={labelStyle} />
                <span style={{ opacity: 0.6, marginRight: 6 }}>共</span>
                <input
                    className="b3-text-field" style={{ ...fieldStyle, width: "4em" }} placeholder="不限"
                    value={countText}
                    onChange={(e) => setCountText(e.target.value)}
                />
                <span style={{ opacity: 0.6, margin: "0 6px" }}>次</span>
                <button
                    className="b3-button b3-button--outline" style={btn}
                    onClick={() => {
                        const n = countText.trim() === "" ? null : Number(countText.trim());
                        void apply(patchRepeatCount(attrs, n), "次数要 ≥ 1 的整数；请先设置重复规则");
                        setCountText("");
                    }}
                >设定</button>
                <span style={{ opacity: 0.6, marginLeft: 6 }}>从</span>
                <select
                    className="b3-select" style={fieldStyle}
                    value={attrs[ATTR.repeatFrom] ?? "due"}
                    onChange={(e) => void apply(patchRepeatFrom(e.target.value))}
                >
                    <option value="due">截止日</option>
                    <option value="done">完成日</option>
                </select>
                <span style={{ opacity: 0.6, marginLeft: 6 }}>递推</span>
            </div>
            <div style={rowStyle}>
                <span style={labelStyle} />
                <span style={{ opacity: 0.6, marginRight: 6 }}>跳过</span>
                <input
                    className="b3-text-field" style={{ ...fieldStyle, width: "8.5em" }} placeholder="yyyyMMdd"
                    value={exdate} onChange={(e) => setExdate(e.target.value)}
                />
                <button
                    className="b3-button b3-button--outline" style={{ ...btn, marginLeft: 4 }}
                    onClick={() => { void apply(patchRepeatExdateAdd(attrs, exdate), "日期格式不对；请先设置重复规则"); setExdate(""); }}
                >加</button>
            </div>
            {repeatExdates(attrs).length > 0 && (
                <div style={{ marginLeft: "3.5em", marginBottom: 6 }}>
                    {repeatExdates(attrs).map((d) => (
                        <div key={d} style={{ fontSize: 12 }}>
                            <span style={{ opacity: 0.7 }}>{pretty(d)}</span>
                            <a style={{ marginLeft: 6, cursor: "pointer", opacity: 0.6 }} onClick={() => void apply(patchRepeatExdateRemove(attrs, d))}>删除</a>
                        </div>
                    ))}
                </div>
            )}

            {/* 清单 */}
            <div style={rowStyle}>
                <span style={labelStyle}>清单</span>
                <input
                    className="b3-text-field" style={{ ...fieldStyle, width: "8em" }} placeholder="清单名"
                    defaultValue={attrs[ATTR.list] ?? ""}
                    onBlur={(e) => void apply(patchList(e.target.value))}
                />
            </div>

            {/* 子任务 */}
            <div style={rowStyle}>
                <span style={labelStyle}>子任务</span>
                <input
                    className="b3-text-field" style={{ ...fieldStyle, flex: 1 }} placeholder="回车添加"
                    value={subtask}
                    onChange={(e) => setSubtask(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || !subtask.trim()) return;
                        void host.appendSubtask(blockId, subtaskMarkdown(subtask)).then(() => {
                            setSubtask("");
                            void reload(blockId);
                        });
                    }}
                />
            </div>

            {/* 底部动作 */}
            <div style={{ ...rowStyle, marginTop: 10, borderTop: "1px solid var(--b3-border-color)", paddingTop: 8 }}>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void host.toggleDone(blockId).then(() => reload(blockId))}>
                    {done ? "取消完成" : "完成"}
                </button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void apply(patchAbandon(!meta.abandoned))}>
                    {meta.abandoned ? "取消放弃" : "放弃"}
                </button>
                <button
                    className="b3-button b3-button--outline" style={{ ...btn, color: "var(--b3-theme-error)" }}
                    onClick={() => {
                        if (!window.confirm("删除这个任务？会进思源回收站，可以恢复。")) return;
                        void host.removeBlock(blockId);
                    }}
                >删除</button>
                <button className="b3-button b3-button--outline" style={btn} onClick={() => void reload()}>刷新</button>
            </div>
            <div style={{ fontSize: 11, opacity: 0.45 }}>{blockId}</div>
        </div>
    );
}
