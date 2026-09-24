/**
 * 块标菜单的「任务」子项。
 *
 * ⚠️ **构建必须同步**：思源的 `click-blockicon` 是同步事件，`menu.addItem` 必须在
 *    事件回调返回前调用；否则菜单已经渲染完，后加的项不会出现。
 *    因此这里不读属性 —— `readAttrs` 推迟到**点击时**（见 `write`）。
 *
 * 判断「是不是任务块」也不在这里做：交给 `api/dom.taskBlockIdFromElement()`（同步、纯 DOM）。
 */

import { ATTR } from "../model/attrs";
import { patchDue, patchPriority, type Attrs, type Patch } from "./panelActions";

export interface MenuItemLike {
    icon?: string;
    label: string;
    click: () => void | Promise<void>;
}

export interface BlockMenuDeps {
    now(): Date;
    /** 读合并后的属性（**点击时**才会调用） */
    readAttrs(id: string): Promise<Record<string, string>>;
    writeAttrs(id: string, patch: Patch): Promise<void>;
    openPanel(id: string): void;
    /** 出错时提示（可选） */
    onError?(message: string): void;
}

const ICON = "iconTaskFlow";

/**
 * 组装菜单项。`taskId` 为空则返回空数组（调用方据此决定不挂菜单）。
 * **同步返回**，不读属性、不做 I/O。
 */
export function buildBlockMenuItems(
    taskId: string | null | undefined,
    deps: BlockMenuDeps,
): MenuItemLike[] {
    if (!taskId) {
        return [];
    }
    const id = taskId;

    const write = (make: (attrs: Attrs) => Patch | null) => async (): Promise<void> => {
        try {
            let attrs: Attrs = {};
            try {
                attrs = await deps.readAttrs(id);
            } catch {
                attrs = {};
            }
            const patch = make(attrs);
            if (patch && patch[ATTR.due] === undefined && Object.keys(attrs).length === 0) {
                // 属性读不到、且这个动作依赖原有形态（如「明天」要保留原时刻）—— 宁可不写
                return;
            }
            if (patch) {
                await deps.writeAttrs(id, patch);
            }
        } catch (e) {
            deps.onError?.((e as Error).message || "写入失败");
        }
    };

    return [
        { icon: ICON, label: "今天", click: write((a) => patchDue(a, "today", deps.now())) },
        { icon: ICON, label: "明天", click: write((a) => patchDue(a, "tomorrow", deps.now())) },
        { icon: ICON, label: "后天", click: write((a) => patchDue(a, "dayAfter", deps.now())) },
        { icon: ICON, label: "清除日期", click: write((a) => patchDue(a, "clear", deps.now())) },
        { icon: ICON, label: "优先级 高", click: write(() => patchPriority("high")) },
        { icon: ICON, label: "优先级 中", click: write(() => patchPriority("medium")) },
        { icon: ICON, label: "优先级 低", click: write(() => patchPriority("low")) },
        { icon: ICON, label: "清除优先级", click: write(() => patchPriority("none")) },
        {
            icon: ICON,
            label: "打开任务面板",
            click: () => {
                try {
                    deps.openPanel(id);
                } catch (e) {
                    deps.onError?.((e as Error).message || "打开面板失败");
                }
            },
        },
    ];
}
