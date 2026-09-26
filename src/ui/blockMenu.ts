/**
 * 块标菜单的「任务」子项。
 *
 * ⚠️ **构建必须同步**：思源的 `click-blockicon` 是同步事件，`menu.addItem` 必须在
 *    事件回调返回前调用；否则菜单已经渲染完，后加的项不会出现。
 *    因此这里不读属性 —— `readAttrs` 推迟到**点击时**（见 `write`）。
 *
 * 判断「点的是什么、它是不是任务」也不在这里做：
 * 交给 `api/dom.blockHitFromElement()`（同步、纯 DOM）+ 调用方的任务 id 索引。
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
    /**
     * 把一个 `- [ ]` 块**升格成任务文档**。
     * ★ 任务 = 文档，所以老模型里的 `- [ ]` 块不再是任务；
     *   要让一条随手记变成真任务，就得把它变成文档。
     */
    promoteToTask?(id: string): Promise<void>;
    /** 取消任务标记（= 同类产品的「转为笔记」：不再当任务，但内容都留着） */
    demoteFromTask?(id: string): Promise<void>;
    /** 出错时提示（可选） */
    onError?(message: string): void;
}

const ICON = "iconTaskFlow";

/**
 * 这次点的是「什么」。
 *
 * 判断在调用方（plugin）做：它手上有同步的任务 id 索引。
 * 这里只按结论组装项集合 —— **纯函数、同步、不读属性、不做 I/O**。
 */
export interface BlockMenuTarget {
    /** 要操作的对象：任务文档 id，或普通块 id */
    id: string;
    /** 这个 id 已经是一个任务文档 */
    isTask: boolean;
}

/**
 * 组装菜单项。`target` 为空则返回空数组（调用方据此决定不挂菜单）。
 * **同步返回**，不读属性、不做 I/O。
 *
 * ⚠️ 项集合**按点击对象分两种**，不能一套走天下 ——
 *    以前的实现在任何情况下都出 11 项（含「转为任务」**和**「不再作为任务」），
 *    对已经是任务的文档给「转为任务」是自相矛盾的。
 */
export function buildBlockMenuItems(
    target: BlockMenuTarget | null | undefined,
    deps: BlockMenuDeps,
): MenuItemLike[] {
    if (!target?.id) {
        return [];
    }
    const id = target.id;

    // 已经是任务 → 只给「改这条任务」的动作；不是 → 只给「把它变成任务」
    if (!target.isTask) {
        return [{
            icon: ICON,
            label: "转为任务（建文档）",
            click: run(() => deps.promoteToTask?.(id), deps),
        }];
    }

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
        {
            icon: ICON,
            label: "不再作为任务",
            click: run(() => deps.demoteFromTask?.(id), deps),
        },
    ];
}

/**
 * 包一层错误处理，菜单点击不该把异常抛到思源那边。
 *
 * ⚠️ 返回的就是那个 async 函数本身，调用方直接 `click: run(...)` ——
 *    写成 `click: () => run(...)` 只会**返回**函数而从不调用它，
 *    表现为「点菜单什么都不发生」（真机+单测都踩到）。
 */
function run(fn: () => Promise<void> | undefined, deps: BlockMenuDeps): () => Promise<void> {
    return async () => {
        try {
            await fn();
        } catch (e) {
            deps.onError?.((e as Error).message || "执行失败");
        }
    };
}
