/**
 * 视图层的数据访问：取数、建收件箱、新建任务。
 * **只做 I/O，不含任何判断** —— 判断都在 views/query.ts 与 views/model.ts（纯函数、可测）。
 */

import { appendTaskItem, callKernel, createDocWithMd, runSql, setBlockAttrs } from "./blocks";
import { waitFor } from "../util/waitFor";

/** 收件箱文档的默认标题，用户可以在思源里改成别的名字 */
export const INBOX_DOC_TITLE = "任务流收件箱";

interface Notebook { id: string; name: string; closed?: boolean }

/** 未关闭的笔记本 */
export async function openNotebooks(): Promise<Notebook[]> {
    const res = await callKernel<{ notebooks?: Notebook[] }>("/api/notebook/lsNotebooks", {});
    return (res?.notebooks ?? []).filter((n) => !n.closed);
}

async function findInboxDoc(): Promise<string | null> {
    const rows = await runSql<{ id: string }>(
        `select id from blocks where type='d' and hpath like '%${INBOX_DOC_TITLE}%' limit 1`,
    );
    return rows[0]?.id ?? null;
}

/**
 * 找或建收件箱文档。
 *
 * **不猜**：优先用调用方给的笔记本，否则第一个未关闭的。一个都没有就返回 null，
 * 让上层明确报错 —— 而不是把任务随手丢到某个位置。
 */
export async function ensureInboxDoc(preferredNotebook?: string): Promise<string | null> {
    const existing = await findInboxDoc();
    if (existing) {
        return existing;
    }
    const notebooks = await openNotebooks();
    const notebook = preferredNotebook ?? notebooks[0]?.id;
    if (!notebook) {
        return null;
    }
    return createDocWithMd(notebook, `/${INBOX_DOC_TITLE}`, `# ${INBOX_DOC_TITLE}\n\n`);
}

/** 在指定文档里新建一条任务，可选带截止日。返回任务项的 id。 */
export async function createTaskIn(docId: string, title: string, due: string | null): Promise<string | null> {
    const id = await appendTaskItem(docId, title);
    if (id && due) {
        await setBlockAttrs(id, { "custom-due": due });
    }
    return id;
}

/** 读某个块的某个属性（单值） */
async function readAttrValue(id: string, name: string): Promise<string> {
    const rows = await runSql<{ v: string | null }>(
        `select (select value from attributes where block_id=b.id and name='${name}') as v
         from blocks b where b.id='${id}' limit 1`,
    );
    return rows[0]?.v ?? "";
}

/**
 * 写属性并**等到它真的能被查到**。
 *
 * 直接 `setBlockAttrs` 后立刻重载会读到旧值 —— 真机实测有约 1 秒的可见性延迟。
 * 视图"改完日期却还是显示旧日期"就是这么来的。
 */
export async function setAttrsAndWait(
    id: string, patch: Record<string, string>, expectKey?: string, expectValue?: string,
): Promise<void> {
    await setBlockAttrs(id, patch);
    if (expectKey === undefined) {
        return;
    }
    await waitFor(
        () => readAttrValue(id, expectKey),
        (v) => v === (expectValue ?? ""),
    );
}

/** 任务文档默认落的笔记本（没有就建一个） */
export const TASK_NOTEBOOK = "任务";

/**
 * 找一个能放任务文档的笔记本。
 *
 * 优先用同名「任务」笔记本；没有就用第一个未关闭的。
 * **不猜、不静默降级** —— 一个都没有就返回 null，让上层明确报错。
 */
export async function ensureTaskNotebook(): Promise<string | null> {
    const notebooks = await openNotebooks();
    const named = notebooks.find((n) => n.name === TASK_NOTEBOOK);
    return named?.id ?? notebooks[0]?.id ?? null;
}

/**
 * 文档标题 → 安全的路径片段。
 *
 * 思源的文档路径不能带 `/` 等字符，否则会建到别的目录去。
 * 标题本身（blocks.content）不受影响，只是路径用清洗过的版本。
 */
export function sanitizeTitle(title: string): string {
    const cleaned = (title ?? "").replace(/[\\/:*?"<>|#\n\r\t]/g, " ").trim();
    return cleaned || "未命名任务";
}

/* ────────────────────────────────────────────────────────────────────────────
 * 「位置即关系」：子任务 = 子文档。
 * 父子关系由**文件树位置**承载（思源的文档树靠 hpath，parent_id 是空的 —— 实测）。
 * 挂/摘父子 = 移动文档，用 moveDocsByID。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 把任务挂到另一个任务下（= 成为它的子任务）。任何层级一步到位。 */
export async function linkTaskUnder(taskId: string, parentId: string): Promise<void> {
    const res = await callKernel<unknown>("/api/filetree/moveDocsByID", {
        fromIDs: [taskId],
        toID: parentId,
    });
    void res;
}

/** 把任务挂回所在笔记本的顶层（= 解除主任务） */
export async function detachTask(taskId: string, notebook: string, rootPath = "/"): Promise<void> {
    await callKernel<unknown>("/api/filetree/moveDocs", {
        fromPaths: [await taskPath(taskId)],
        toNotebook: notebook,
        toPath: rootPath,
    });
}

/** 取文档路径（moveDocs 按路径操作） */
async function taskPath(id: string): Promise<string> {
    const rows = await runSql<{ hpath: string }>(`select hpath from blocks where id='${id}' limit 1`);
    return rows[0]?.hpath ?? "";
}

/**
 * 在某个任务下新建子任务（= 建子文档）。
 *
 * 做法是「先在根目录建，再挂进去」而不是直接拼 hpath：
 * 路径里可能有需要转义的字符，而且这样能复用已实测可用的挂载路径。
 */
export async function createSubTask(parentId: string, title: string): Promise<string | null> {
    const rows = await runSql<{ box: string }>(`select box from blocks where id='${parentId}' limit 1`);
    const notebook = rows[0]?.box;
    if (!notebook) {
        return null;
    }
    const id = await createDocWithMd(notebook, `/${sanitizeTitle(title)}`, `# ${title}\n\n`);
    if (!id) {
        return null;
    }
    await linkTaskUnder(id, parentId);
    await setAttrsAndWait(id, { "custom-task": "1" }, "custom-task", "1");
    return id;
}

/** 某个任务的直属子任务（= 子文档）。按路径前缀取。 */
export async function childTasksOf(parentId: string): Promise<{ id: string; title: string }[]> {
    const rows = await runSql<{ hpath: string }>(
        `select hpath from blocks where id='${parentId}' limit 1`,
    );
    const hp = rows[0]?.hpath;
    if (!hp) {
        return [];
    }
    // hpath 前缀能框住整棵子树；再按 '/' 段数筛掉更深的层级，只留直属子
    const depth = hp.split("/").filter(Boolean).length;
    const children = await runSql<{ id: string; hpath: string; title: string }>(
        `select id, hpath, content as title from blocks
         where type='d' and hpath like '${hp}/%'
         order by hpath`,
    );
    return children
        .filter((c) => c.hpath.split("/").filter(Boolean).length === depth + 1)
        .map((c) => ({ id: c.id, title: c.title }));
}
