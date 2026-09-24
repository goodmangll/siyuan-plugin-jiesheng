/**
 * 面板动作层：**用户点了一下 → 该写什么属性**。
 *
 * 这一层是纯函数，不碰 DOM、不碰思源 API，面板组件只负责把返回值交给 `setBlockAttrs`。
 * 目的：把面板里所有「判断」都挪到可测的地方。
 */

import { ATTR } from "../model/attrs";
import { addDays, isAllDay, parseDate, toDateStr } from "../model/date";
import { priorityAttr, type Priority } from "../model/priority";
import { formatOffsets, offsetToAbsolute, parseOffsets, shiftReminders } from "../model/remind";
import { formatRule, fromPreset, parseRule, type PresetId } from "../model/repeat";

export type Attrs = Record<string, string>;

// shiftReminders 已经挪到 model/remind（model 不该依赖 ui）；这里转出去保持调用方不变
export { shiftReminders } from "../model/remind";
export type Patch = Record<string, string>;

// ── 日期 ─────────────────────────────────────────────────────────────────────

export type DueKind = "today" | "tomorrow" | "dayAfter" | "clear";

/**
 * 日期补丁。**保留原来的形态**：全天进全天出，有时刻进有时刻出。
 * 若原本有提醒，会按 due 的变化量一起平移（见 `shiftReminders`）。
 */
export function patchDue(attrs: Attrs, kind: DueKind, now: Date): Patch {
    const old = attrs[ATTR.due];
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = kind === "today" ? base
        : kind === "tomorrow" ? addDays(base, 1)
            : kind === "dayAfter" ? addDays(base, 2)
                : base;

    const value = kind === "clear"
        ? ""
        : (!old || isAllDay(old) ? toDateStr(target) : toDateStr(target) + old.slice(8, 12));

    const patch: Patch = { [ATTR.due]: value };
    const existing = parseOffsets(attrs[ATTR.remind]);
    if (existing.length > 0) {
        const shifted = shiftReminders(existing, old, value);
        // 只在真的变了时才写，避免无意义地把 remind 也标脏
        if (shifted.join(" ") !== existing.join(" ")) {
            patch[ATTR.remind] = formatOffsets(shifted);
        }
    }
    return patch;
}

/** 时间段：同时给开始与截止 */
export function patchRange(start: string, due: string): Patch {
    return { [ATTR.start]: (start ?? "").trim(), [ATTR.due]: (due ?? "").trim() };
}

// ── 优先级 ───────────────────────────────────────────────────────────────────

export function patchPriority(level: Priority): Patch {
    return { [ATTR.pri]: priorityAttr(level) ?? "" };
}

// ── 提醒 ─────────────────────────────────────────────────────────────────────

export interface RemindPreset {
    id: string;
    label: string;
    /** 相对 due 的偏移语法，见 model/remind */
    offset: string;
}

export const REMIND_PRESETS: RemindPreset[] = [
    { id: "at0", label: "当天 09:00", offset: "0d09:00" },
    { id: "d1", label: "提前 1 天 09:00", offset: "-1d09:00" },
    { id: "d2", label: "提前 2 天 09:00", offset: "-2d09:00" },
    { id: "d3", label: "提前 3 天 09:00", offset: "-3d09:00" },
    { id: "w1", label: "提前 1 周 09:00", offset: "-1w09:00" },
    { id: "m5", label: "提前 5 分钟", offset: "-5m" },
    { id: "ontime", label: "准点", offset: "0" },
];

/** 预设提醒：相对 due 展开成绝对时刻后并入列表。没有 due 时返回 null（由 UI 提示）。 */
export function patchRemindPreset(attrs: Attrs, presetId: string): Patch | null {
    const due = attrs[ATTR.due];
    if (!due) {
        return null;
    }
    const preset = REMIND_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
        return null;
    }
    const at = offsetToAbsolute(due, preset.offset);
    if (!at) {
        return null;
    }
    return withRemind(attrs, (list) => [...list, at]);
}

/** 自定义绝对时刻：并入列表 */
export function patchRemindAdd(attrs: Attrs, at: string): Patch | null {
    if (!/^\d{8}(\d{4})?$/.test((at ?? "").trim())) {
        return null;
    }
    return withRemind(attrs, (list) => [...list, at.trim()]);
}

/** 删除一条 */
export function patchRemindRemove(attrs: Attrs, at: string): Patch {
    return withRemind(attrs, (list) => list.filter((x) => x !== at));
}

/** 清空 */
export function patchRemindClear(): Patch {
    return { [ATTR.remind]: "" };
}

function withRemind(attrs: Attrs, fn: (list: string[]) => string[]): Patch {
    const list = fn(parseOffsets(attrs[ATTR.remind]));
    const uniq = [...new Set(list)].sort();
    return { [ATTR.remind]: formatOffsets(uniq) };
}

// ── 重复 ─────────────────────────────────────────────────────────────────────

/** 预设重复。anchor 取当前 due；没有 due 则取今天。 */
export function patchRepeatPreset(attrs: Attrs, id: PresetId, now: Date): Patch {
    const anchor = parseDate(attrs[ATTR.due]) ?? now;
    return { [ATTR.repeat]: fromPreset(id, anchor) };
}

/** 结束条件：给日期就写入 UNTIL，否则移除 UNTIL（= 一直重复） */
export function patchRepeatUntil(attrs: Attrs, until: string | null): Patch | null {
    const raw = attrs[ATTR.repeat];
    if (!raw) {
        return null;
    }
    const rule = parseRule(raw);
    if (!rule) {
        return null;
    }
    const next = { ...rule };
    if (until && /^\d{8}$/.test(until)) {
        next.until = until;
    } else {
        delete next.until;
    }
    return { [ATTR.repeat]: formatRule(next) };
}

export function patchRepeatClear(): Patch {
    return { [ATTR.repeat]: "" };
}

// ── 清单 / 放弃 ──────────────────────────────────────────────────────────────

export function patchList(name: string | null): Patch {
    const v = (name ?? "").trim();
    return { [ATTR.list]: v };
}

export function patchAbandon(on: boolean): Patch {
    return { [ATTR.abandoned]: on ? "1" : "" };
}

// ── 子任务 ───────────────────────────────────────────────────────────────────

/** 子任务要插入的 markdown：缩进两级，落在任务项内部 */
export function subtaskMarkdown(title: string): string {
    return `  - [ ] ${(title ?? "").trim()}`;
}
