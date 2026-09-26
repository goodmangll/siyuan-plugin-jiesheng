/**
 * 任务的写操作 —— 行为层，不碰插件生命周期。
 *
 * 每个函数都只声明自己需要什么（依赖注入），所以可以脱离思源单测。
 * 原来这些都挂在 `Plugin` 子类的 `this` 上，既测不了、也让插件类膨胀。
 */

import {
    callKernel, createDocWithMd, deleteBlock, getBlockKramdown, getTaskAttrs, getTaskTitle, runSql,
} from "../api/blocks";
import { setAttrsAndWait } from "../api/views";
import { ATTR } from "../model/attrs";
import { splitTaskBlock } from "../model/body";
import { generateNextRepeat, type GenerateDeps } from "../generate";
import { ensureTaskNotebook, sanitizeTitle } from "../api/views";

export interface ActionResult {
    ok: boolean;
    /** 失败原因（给用户看的一句话） */
    message?: string;
    /** 成功后的提示（可选） */
    toast?: string;
    /** 新建出来的文档 id（转任务用） */
    id?: string;
}

const fail = (message: string): ActionResult => ({ ok: false, message });

/** 重复任务的生成依赖 —— 抽出来只因为它在两处被用到 */
export function buildGenerateDeps(): GenerateDeps {
    return {
        now: () => new Date(),
        readAttrs: (id: string) => getTaskAttrs(id),
        readTitle: (id: string) => getTaskTitle(id),
        exportBody: async (id: string) => {
            const res = await callKernel<{ content?: string }>("/api/export/exportMdContent", { id });
            return res?.content ?? "";
        },
        notebookOf: async (id: string) => {
            const rows = await runSql<{ box: string }>(`select box from blocks where id='${id}' limit 1`);
            return rows[0]?.box ?? null;
        },
        createDoc: (notebook: string, title: string, markdown: string) =>
            createDocWithMd(notebook, `/${sanitizeTitle(title)}`, markdown),
        writeAttrs: (id: string, patch: Record<string, string>) => setAttrsAndWait(id, patch, ATTR.task, "1"),
    };
}

/**
 * 切换完成状态。
 *
 * 写成 `custom-done` 时间戳（文档没有复选框），**并且**：从「未完成 → 完成」
 * 时如果有重复规则，顺带生成下一个。
 */
export async function toggleTaskDone(
    id: string,
    deps: { generateDeps?: GenerateDeps } = {},
): Promise<ActionResult> {
    const attrs = await getTaskAttrs(id);
    const wasDone = (attrs[ATTR.done] ?? "").trim() !== "";
    const next = wasDone ? "" : stamp();
    await setAttrsAndWait(id, { [ATTR.done]: next }, ATTR.done, next);

    if (!wasDone) {
        try {
            await generateNextRepeat(id, deps.generateDeps ?? buildGenerateDeps());
        } catch (e) {
            // 生成失败不影响「完成任务」本身
            return { ok: true, message: "任务流：" + ((e as Error)?.message ?? "重复生成失败") };
        }
    }
    return { ok: true };
}

function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 新建任务文档（任务 = 文档） */
export async function createTaskDoc(title: string, due: string | null): Promise<ActionResult> {
    const notebook = await ensureTaskNotebook();
    if (!notebook) {
        return fail("任务流：找不到可用的笔记本，无法新建任务");
    }
    // markdown 里**不写 `# 标题`** —— 标题由路径给出，写了会变成正文里的第一个块
    const id = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, "");
    if (!id) {
        return fail("任务流：新建任务文档失败");
    }
    const patch: Record<string, string> = { [ATTR.task]: "1" };
    if (due) {
        patch[ATTR.due] = due;
    }
    await setAttrsAndWait(id, patch, ATTR.task, "1");
    return { ok: true, id };
}

/**
 * 「转为任务（建文档）」。
 *
 * 顺序很重要：**先把文档建好，再删原块** —— 反过来的话建文档失败就把内容弄丢了。
 */
export async function promoteBlockToTask(blockId: string): Promise<ActionResult> {
    const notebook = await ensureTaskNotebook();
    if (!notebook) {
        return fail("任务流：找不到可用的笔记本");
    }
    const kr = await getBlockKramdown(blockId);
    const { title, body } = splitTaskBlock(kr);
    if (!title) {
        return fail("任务流：这个块没有标题，无法转为任务");
    }
    const newId = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, body);
    if (!newId) {
        return fail("任务流：建文档失败，原内容未改动");
    }
    await setAttrsAndWait(newId, { [ATTR.task]: "1" }, ATTR.task, "1");
    await deleteBlock(blockId);
    return { ok: true, id: newId, toast: "已转为任务：" + title };
}
