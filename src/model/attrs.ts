/**
 * 属性层：把「块属性 map」翻译成强类型的 TaskMeta，并处理**属性宿主**问题。
 *
 * 属性宿主（M0 实测发现）：
 *   用 markdown 手写 ial 时，属性落在**内层段落块**；
 *   用 `setBlockAttrs` 时，属性落在**列表项块**。
 *
 *   规则：写入一律写列表项块；**读取时先读列表项块，读不到再回退读内层段落块**；
 *   两者都有时列表项块优先；列表项块上显式空串视为「已删除」，不再回退。
 */

import { isValidDateStr } from "./date";
import { parsePriority, type Priority } from "./priority";
import { parseOffsets } from "./remind";
import { parseRule, type RepeatRule } from "./repeat";

/** 本插件保留的属性名（思源会自动补 custom- 前缀） */
export const ATTR = {
    due: "custom-due",
    start: "custom-start",
    pri: "custom-pri",
    remind: "custom-remind",
    repeat: "custom-repeat",
    repeatFrom: "custom-repeat-from",
    list: "custom-list",
    done: "custom-done",
    abandoned: "custom-abandoned",
    spent: "custom-spent",
} as const;

export type AttrName = (typeof ATTR)[keyof typeof ATTR];

export interface TaskMeta {
    /** `yyyyMMdd` 或 `yyyyMMddHHmm` */
    due?: string;
    start?: string;
    pri: Priority;
    /** 绝对时刻列表，`yyyyMMddHHmm` */
    remind: string[];
    repeat: RepeatRule | null;
    /** `due`（从截止日递推，默认）或 `done`（从完成日递推） */
    repeatFrom?: string;
    list?: string;
    done?: string;
    abandoned: boolean;
    spent?: number;
}

/**
 * 合并两个属性来源。`block` = 列表项块，`inner` = 内层段落块。
 * block 里出现过的键（含空串）一律以 block 为准，不做回落。
 */
export function mergeAttrs(
    block: Record<string, string> | null | undefined,
    inner: Record<string, string> | null | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(inner ?? {})) {
        if (typeof v === "string") {
            out[k] = v;
        }
    }
    for (const [k, v] of Object.entries(block ?? {})) {
        if (typeof v === "string") {
            out[k] = v;
        }
    }
    return out;
}

/** 取一个属性值；空串 / 缺失都返回 undefined */
export function readAttr(attrs: Record<string, string>, name: string): string | undefined {
    const v = attrs[name];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** 属性 map → TaskMeta；非法值一律当作「没有」，不原样透出 */
export function toMeta(attrs: Record<string, string>): TaskMeta {
    const due = readAttr(attrs, ATTR.due);
    const start = readAttr(attrs, ATTR.start);
    const done = readAttr(attrs, ATTR.done);
    const repeatRaw = readAttr(attrs, ATTR.repeat);
    const spentRaw = readAttr(attrs, ATTR.spent);

    return {
        due: isValidDateStr(due) ? due : undefined,
        start: isValidDateStr(start) ? start : undefined,
        pri: parsePriority(readAttr(attrs, ATTR.pri)),
        remind: parseOffsets(readAttr(attrs, ATTR.remind)),
        repeat: repeatRaw ? parseRule(repeatRaw) : null,
        repeatFrom: readAttr(attrs, ATTR.repeatFrom),
        list: readAttr(attrs, ATTR.list),
        done: isValidDateStr(done) ? done : undefined,
        abandoned: readAttr(attrs, ATTR.abandoned) === "1",
        spent: spentRaw !== undefined && Number.isFinite(Number(spentRaw)) ? Number(spentRaw) : undefined,
    };
}

/**
 * 变更集 → 要写给 `setBlockAttrs` 的补丁。
 * `null` 表示删除该属性：思源里把属性值设为空串即等于移除。
 */
export function toAttrPatch(patch: Partial<{
    due: string | null;
    start: string | null;
    pri: string | null;
    remind: string[] | null;
    repeat: string | null;
    repeatFrom: string | null;
    list: string | null;
    done: string | null;
    abandoned: boolean | null;
    spent: number | null;
}>): Record<string, string> {
    const out: Record<string, string> = {};
    const put = (key: string, value: string | null) => {
        out[key] = value ?? "";
    };
    if ("due" in patch) {
        put(ATTR.due, patch.due ?? null);
    }
    if ("start" in patch) {
        put(ATTR.start, patch.start ?? null);
    }
    if ("pri" in patch) {
        put(ATTR.pri, patch.pri ?? null);
    }
    if ("remind" in patch) {
        put(ATTR.remind, patch.remind && patch.remind.length ? patch.remind.join(" ") : null);
    }
    if ("repeat" in patch) {
        put(ATTR.repeat, patch.repeat ?? null);
    }
    if ("repeatFrom" in patch) {
        put(ATTR.repeatFrom, patch.repeatFrom ?? null);
    }
    if ("list" in patch) {
        put(ATTR.list, patch.list ?? null);
    }
    if ("done" in patch) {
        put(ATTR.done, patch.done ?? null);
    }
    if ("abandoned" in patch) {
        put(ATTR.abandoned, patch.abandoned ? "1" : null);
    }
    if ("spent" in patch) {
        put(ATTR.spent, patch.spent === null || patch.spent === undefined ? null : String(patch.spent));
    }
    return out;
}
