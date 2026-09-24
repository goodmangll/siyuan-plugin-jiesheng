/**
 * 重复任务生成：把「一个刚完成的任务」变成「列表里多出来的一条未完成任务」。
 *
 * 纯编排 + 依赖注入 —— 算日期在 `model/repeatTask`，这里只管「谁读、谁写、写什么」。
 */

import { ATTR, toMeta } from "./model/attrs";
import { priorityAttr } from "./model/priority";
import { nextRepeatTask } from "./model/repeatTask";

export interface GenerateDeps {
    now(): Date;
    readAttrs(id: string): Promise<Record<string, string>>;
    readTitle(id: string): Promise<string>;
    /** 在原任务**后面**插入新块，返回新块 id */
    insertAfter(previousId: string, markdown: string): Promise<string | null>;
    writeAttrs(id: string, patch: Record<string, string>): Promise<void>;
    toast?(message: string): void;
}

/** 新任务的 markdown：一条全新的未完成任务 */
export function repeatTaskMarkdown(title: string): string {
    return `- [ ] ${(title ?? "").trim()}`;
}

/**
 * 生成下一个重复任务。返回新块 id；不生成时返回 null。
 *
 * 不会抛异常 —— 重复生成失败不该把「完成任务」这个动作也搞失败。
 */
export async function generateNextRepeat(taskId: string, deps: GenerateDeps): Promise<string | null> {
    try {
        const attrs = await deps.readAttrs(taskId);
        const meta = toMeta(attrs);
        if (!meta.repeat) {
            return null;
        }

        const next = nextRepeatTask(meta, deps.now());
        if (!next) {
            deps.toast?.("任务流：重复已结束，不再生成");
            return null;
        }

        const title = await deps.readTitle(taskId);
        const newId = await deps.insertAfter(taskId, repeatTaskMarkdown(title));
        if (!newId) {
            deps.toast?.("任务流：重复任务生成失败（拿不到新块 id）");
            return null;
        }

        const patch: Record<string, string> = {
            [ATTR.due]: next.due ?? "",
            [ATTR.remind]: next.remind.join(" "),
            [ATTR.repeat]: next.repeat,
        };
        if (next.start !== undefined) {
            patch[ATTR.start] = next.start;
        }
        if (meta.list) {
            patch[ATTR.list] = meta.list;
        }
        const pri = priorityAttr(meta.pri);
        if (pri) {
            patch[ATTR.pri] = pri;
        }
        await deps.writeAttrs(newId, patch);
        return newId;
    } catch (e) {
        deps.toast?.("任务流：重复任务生成出错 —— " + ((e as Error)?.message ?? String(e)));
        return null;
    }
}
