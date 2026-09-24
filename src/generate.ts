/**
 * 重复任务生成：把「一个刚完成的任务」变成「列表里多出来的一条未完成任务」。
 *
 * ★ 任务 = 文档 → 生成的下一条**也是一个文档**：
 *     复制上一轮的正文（不含 frontmatter）、落在同一个笔记本、重算 due/remind/repeat。
 *
 * 算日期在 `model/repeatTask`（纯函数、已测），这里只管「谁读、谁写、写什么」。
 */

import { ATTR, toMeta } from "./model/attrs";
import { priorityAttr } from "./model/priority";
import { cleanDocBody } from "./model/body";
import { nextRepeatTask } from "./model/repeatTask";

export interface GenerateDeps {
    now(): Date;
    readAttrs(id: string): Promise<Record<string, string>>;
    readTitle(id: string): Promise<string>;
    /** 导出正文（含 frontmatter，本模块会剥掉） */
    exportBody(id: string): Promise<string>;
    /** 文档所在笔记本 */
    notebookOf(id: string): Promise<string | null>;
    /** 建一个文档，返回新文档 id */
    createDoc(notebook: string, title: string, markdown: string): Promise<string | null>;
    writeAttrs(id: string, patch: Record<string, string>): Promise<void>;
    toast?(message: string): void;
}

/**
 * 新任务的正文字。
 *
 * ★ **不写 `# 标题`**：文档标题由路径给出，markdown 里再写一个 h1，
 *   那个 h1 会原样变成正文里的第一个块（真机实测，标题会重复）。
 * ★ 清理放在**内部**，调用方忘不掉 —— 正文里多出 frontmatter 或重复标题
 *   是很隐蔽的脏数据。
 */
export function composeBody(title: string, body: string): string {
    const b = cleanDocBody(body ?? "", title).trim();
    return b ? `${b}\n` : "";
}

/**
 * 生成下一个重复任务。返回新文档 id；不生成时返回 null。
 *
 * **不会抛异常** —— 重复生成失败不该把「完成任务」这个动作也搞失败。
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

        const notebook = await deps.notebookOf(taskId);
        if (!notebook) {
            deps.toast?.("任务流：找不到任务所在笔记本，无法生成重复任务");
            return null;
        }

        const title = await deps.readTitle(taskId);
        const body = await deps.exportBody(taskId);
        const newId = await deps.createDoc(notebook, title, composeBody(title, body));
        if (!newId) {
            deps.toast?.("任务流：重复任务生成失败（拿不到新文档 id）");
            return null;
        }

        const patch: Record<string, string> = {
            [ATTR.task]: "1",
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
