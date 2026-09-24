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

/**
 * 时间段：同时给开始与截止（面板里直接编辑两个输入框时走这里）。
 *
 * **必须和 `patchDue` 一样处理提醒平移** —— 提醒存的是绝对时刻，
 * 截止日改了而提醒不动，用户看到的「提前 1 天 09:00」就变成了无意义的时刻。
 * 这条曾经漏掉过：面板按钮改日期会平移，手输日期不会。
 */
export function patchRange(attrs: Attrs, start: string, due: string): Patch {
    const oldDue = attrs[ATTR.due];
    const newDue = (due ?? "").trim();
    const patch: Patch = { [ATTR.start]: (start ?? "").trim(), [ATTR.due]: newDue };

    const existing = parseOffsets(attrs[ATTR.remind]);
    if (existing.length === 0) {
        return patch;
    }
    if (newDue === "") {
        // 截止日没了，提醒指向一个不存在的日期 —— 一并清掉
        patch[ATTR.remind] = "";
        return patch;
    }
    if (oldDue === newDue) {
        return patch;
    }
    const shifted = shiftReminders(existing, oldDue, newDue);
    if (shifted.join(" ") !== existing.join(" ")) {
        patch[ATTR.remind] = formatOffsets(shifted);
    }
    return patch;
}

/** 关掉「全天」时补的默认时刻 */
export const DEFAULT_TIME = "0900";

/** 开始时间：`yyyyMMdd` / `yyyyMMddHHmm`；空 = 清除。非法输入返回 null（不写坏数据）。 */
export function patchStart(value: string | null | undefined): Patch | null {
    const v = (value ?? "").trim();
    if (v === "") {
        return { [ATTR.start]: "" };
    }
    if (!isValidInputDate(v)) {
        return null;
    }
    return { [ATTR.start]: v };
}

/**
 * 全天开关。
 *
 * 「全天」不是单独存的字段 —— **它就是 due 的形态**：8 位 = 全天，12 位 = 有时刻。
 * 所以这里只做形态转换：开 → 砍掉时刻；关 → 补上 `DEFAULT_TIME`。
 *
 * **提醒不动**：日期没变，只有时刻形态变了。若这里去调 shiftReminders，
 * 会把 14:30 的 due 变成全天后算出 -14.5 小时的偏移，把提醒整体挪到前一天去。
 */
export function patchAllDay(attrs: Attrs, allDay: boolean): Patch {
    const patch: Patch = {};
    for (const key of [ATTR.due, ATTR.start]) {
        const v = attrs[key];
        if (!v) {
            continue;
        }
        if (allDay) {
            patch[key] = v.slice(0, 8);
        } else if (isAllDay(v)) {
            patch[key] = v.slice(0, 8) + DEFAULT_TIME;
        }
    }
    return patch;
}

/** 校验用户输入的日期串（8 或 12 位，且真的是个日期） */
function isValidInputDate(v: string): boolean {
    if (!/^(\d{8}|\d{12})$/.test(v)) {
        return false;
    }
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6));
    const d = Number(v.slice(6, 8));
    if (m < 1 || m > 12 || d < 1 || d > 31) {
        return false;
    }
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
        return false;
    }
    if (v.length === 12) {
        const hh = Number(v.slice(8, 10));
        const mi = Number(v.slice(10, 12));
        return hh <= 23 && mi <= 59;
    }
    return true;
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

/** 递推基准：`done`（从完成日）或其它（一律按默认 `due`） */
export function patchRepeatFrom(value: string | null | undefined): Patch {
    return { [ATTR.repeatFrom]: (value ?? "").trim() === "done" ? "done" : "" };
}

/** 读取重复规则里的 UNTIL，给面板输入框回显用 */
export function repeatRuleUntil(attrs: Attrs): string | undefined {
    return parseRule(attrs[ATTR.repeat] ?? "")?.until;
}

/** 重复次数：null = 不限。次数要 ≥ 1（0 次意味着这条根本不该存在）。 */
export function patchRepeatCount(attrs: Attrs, count: number | null): Patch | null {
    const rule = parseRule(attrs[ATTR.repeat] ?? "");
    if (!rule) {
        return null;
    }
    const next = { ...rule };
    if (count === null) {
        delete next.count;
    } else if (!Number.isInteger(count) || count < 1) {
        return null;
    } else {
        next.count = count;
    }
    return { [ATTR.repeat]: formatRule(next) };
}

/** 排除日期：加一个（幂等、自动排序） */
export function patchRepeatExdateAdd(attrs: Attrs, date: string): Patch | null {
    if (!/^\d{8}$/.test((date ?? "").trim())) {
        return null;
    }
    return withExdate(attrs, (list) => [...list, date.trim()]);
}

/** 排除日期：删一个 */
export function patchRepeatExdateRemove(attrs: Attrs, date: string): Patch | null {
    return withExdate(attrs, (list) => list.filter((x) => x !== (date ?? "").trim()));
}

/** 读取当前的排除日期，给 UI 列表用 */
export function repeatExdates(attrs: Attrs): string[] {
    return parseRule(attrs[ATTR.repeat] ?? "")?.exDate ?? [];
}

function withExdate(attrs: Attrs, fn: (list: string[]) => string[]): Patch | null {
    const rule = parseRule(attrs[ATTR.repeat] ?? "");
    if (!rule) {
        return null;
    }
    const uniq = [...new Set(fn(rule.exDate ?? []))].sort();
    const next = { ...rule };
    if (uniq.length) {
        next.exDate = uniq;
    } else {
        delete next.exDate;
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
