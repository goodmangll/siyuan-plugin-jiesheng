/**
 * 内核 API 层。
 *
 * **不直接 import "siyuan"** —— 通过注入 transport 让这一层可以脱离思源运行：
 *   - 单测：注入假 transport，验证「调了哪些 API、参数对不对」
 *   - 集成验证：注入基于 HTTP 的真 transport，对真实内核跑
 *   - 线上：由 plugin.ts 注入思源的 fetchPost
 */

import { bodyBlocks, type BodyBlock } from "../model/body";

export interface KernelResponse {
    code: number;
    msg?: string;
    data?: unknown;
}

export type Transport = (url: string, data?: Record<string, unknown>) => Promise<KernelResponse | undefined>;

/** 未注入 transport 时调用会抛错——避免在非思源环境里静默失败 */
let transport: Transport = () => {
    throw new Error("jiesheng: transport 未注入");
};

export function setTransport(t: Transport): void {
    transport = t;
}

/**
 * 统一的内核调用（走注入的 transport）。校验 code 并抛错 —— **不静默吞掉失败**。
 * 对外暴露是因为「列笔记本」这类接口不属于 blocks，但该走同一套错误处理。
 */
export async function callKernel<T>(url: string, data?: Record<string, unknown>): Promise<T> {
    return call<T>(url, data);
}

async function call<T>(url: string, data?: Record<string, unknown>): Promise<T> {
    const res = await transport(url, data);
    if (!res || typeof res.code !== "number") {
        throw new Error(`jiesheng: ${url} 返回异常`);
    }
    if (res.code !== 0) {
        throw new Error(`jiesheng: ${url} 失败 code=${res.code} ${res.msg ?? ""}`);
    }
    return res.data as T;
}

// ── 属性 ─────────────────────────────────────────────────────────────────────

/** 读一个块的全部属性（含 custom-*） */
export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
    const d = await call<Record<string, string>>("/api/attr/getBlockAttrs", { id });
    return d ?? {};
}

/** 写属性。值为空串表示删除该属性（思源语义）。 */
export async function setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
    await call<null>("/api/attr/setBlockAttrs", { id, attrs });
}

// ── kramdown ─────────────────────────────────────────────────────────────────

export async function getBlockKramdown(id: string): Promise<string> {
    const d = await call<{ kramdown: string }>("/api/block/getBlockKramdown", { id });
    return d?.kramdown ?? "";
}

export async function updateBlockMarkdown(id: string, markdown: string): Promise<void> {
    await call<unknown>("/api/block/updateBlock", { id, dataType: "markdown", data: markdown });
}

// ── 块层级（用于「双宿主」与「子任务判定」） ───────────────────────────────────

export interface BlockRow {
    id: string;
    type: string;
    subtype: string;
    parent_id: string;
    root_id: string;
}

const SQL = "/api/query/sql";

/** 直接跑 SQL。视图层要用它批量取数，所以对外暴露。 */
export async function runSql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
    return (await call<T[]>(SQL, { stmt })) ?? [];
}

async function sql<T = BlockRow>(stmt: string): Promise<T[]> {
    return (await call<T[]>(SQL, { stmt })) ?? [];
}

/** 列表项块的第一个内层段落块 id；没有则 null（markdown 手写 ial 时属性落在这里） */
export async function firstInnerParagraph(taskBlockId: string): Promise<string | null> {
    const rows = await sql(
        `select id from blocks where parent_id='${taskBlockId}' and type='p' order by sort*1 limit 1`,
    );
    return rows.length ? rows[0].id : null;
}

/**
 * 读任务的全部属性 —— 处理 M0 发现的双宿主问题。
 * 列表项块上的键优先；它没有的键才去内层段落块找。
 */
export async function getTaskAttrs(taskBlockId: string, innerId?: string | null): Promise<Record<string, string>> {
    const block = await getBlockAttrs(taskBlockId);
    const inner = innerId === undefined ? await firstInnerParagraph(taskBlockId) : innerId;
    if (!inner) {
        return block;
    }
    const innerAttrs = await getBlockAttrs(inner);
    return { ...innerAttrs, ...block };
}

/** 该块是不是任务列表项 */
export async function isTaskBlock(id: string): Promise<boolean> {
    const rows = await sql(`select id from blocks where id='${id}' and type='i' and subtype='t' limit 1`);
    return rows.length > 0;
}

/** 是不是子任务：父级是列表块、祖父是任务项 */
export async function isSubtaskBlock(id: string): Promise<boolean> {
    const rows = await sql<{ ptype: string; gtype: string; gsub: string }>(
        `select p.type ptype, g.type gtype, g.subtype gsub
           from blocks b
           join blocks p on p.id = b.parent_id
           left join blocks g on g.id = p.parent_id
          where b.id = '${id}' limit 1`,
    );
    if (!rows.length) {
        return false;
    }
    const r = rows[0];
    return r.ptype === "l" && r.gtype === "i" && r.gsub === "t";
}

// ── 文档 ─────────────────────────────────────────────────────────────────────

export async function createDocWithMd(notebook: string, path: string, markdown: string): Promise<string | null> {
    return call<string | null>("/api/filetree/createDocWithMd", { notebook, path, markdown });
}

export async function removeDocByID(id: string): Promise<void> {
    await call<null>("/api/filetree/removeDocByID", { id });
}

/**
 * 把一个块归一化成「它所属的任务项」。
 *
 * 为什么需要：**光标通常落在段落块上，不在列表项块上**。
 * 结构是 `i(任务) > [ p(正文) , l > i(子任务) > p ]`，所以从光标处最多向上走两层。
 * 子任务向上找到的是它自己的 `i`，不会跑到父任务 —— 因为它的直接父级就是自己的 `i`。
 */
/**
 * 归一化：把「光标所在的块」变成「它所属的任务文档」。
 *
 * ★ 任务 = 文档。所以这里的语义是：**往上找到所属的文档，再判断那个文档是不是任务**
 *   （带 `custom-task="1"` 标记）。不是任务文档 → 返回 null。
 *
 * 为什么必须往上找：光标几乎不会停在文档块本身上，而是停在它内部的段落/标题上。
 * 只认起始块的话，在任务文档里写正文时按快捷键会毫无反应。
 *
 * `maxUp` 是防御性上限；文档树的层级再深也不会超过它，而数据异常时不至于死循环。
 */
export async function resolveTaskBlock(id: string, maxUp = 16): Promise<string | null> {
    interface Row { id: string; type: string; subtype: string; parent_id: string }
    let rows = await sql<Row>(`select id, type, subtype, parent_id from blocks where id='${id}' limit 1`);
    if (!rows.length) {
        return null;
    }
    let cur = rows[0];

    // 起始块本身就是 `- [ ]` 任务项（老模型的块）→ 直接认，保持兼容
    if (cur.type === "i" && cur.subtype === "t") {
        return cur.id;
    }

    for (let i = 0; i < maxUp; i++) {
        if (cur.type === "d") {
            // 找到所属文档了 —— 它是不是任务？
            return (await isTaskDoc(cur.id)) ? cur.id : null;
        }
        if (!cur.parent_id) {
            return null;
        }
        rows = await sql<Row>(`select id, type, subtype, parent_id from blocks where id='${cur.parent_id}' limit 1`);
        if (!rows.length) {
            return null;
        }
        cur = rows[0];
    }
    return null;
}

/** 这个文档是不是「任务文档」（带 custom-task="1" 标记） */
export async function isTaskDoc(id: string): Promise<boolean> {
    const rows = await sql(
        `select id from attributes where block_id='${id}' and name='custom-task' and value='1' limit 1`,
    );
    return rows.length > 0;
}

export async function appendBlock(parentID: string, markdown: string): Promise<void> {
    await call<unknown>("/api/block/appendBlock", { parentID, dataType: "markdown", data: markdown });
}

/**
 * 在某个块**后面**插入一个新块，返回新块的 id（拿不到则 null）。
 * 用于「重复任务生成」：把下一个 `- [ ]` 紧跟在刚完成的那条后面。
 */
export async function insertBlockAfter(previousID: string, markdown: string): Promise<string | null> {
    const d = await call<unknown>("/api/block/insertBlock", {
        previousID, dataType: "markdown", data: markdown,
    });
    // 思源的返回形态不稳定：可能直接是 id 字符串、也可能是 operation 数组
    if (typeof d === "string" && d) {
        return d;
    }
    const arr = Array.isArray(d) ? d : [];
    for (const op of arr) {
        const id = (op as { id?: string; doOperations?: { id?: string }[] })?.id
            ?? (op as { doOperations?: { id?: string }[] })?.doOperations?.[0]?.id;
        if (id) {
            return id;
        }
    }
    return null;
}

/** 取任务标题（从 kramdown 首行解析，避免把子块文本带进来） */

/** 删除块（进思源回收站，可恢复） */
export async function deleteBlock(id: string): Promise<void> {
    await call<unknown>("/api/block/deleteBlock", { id });
}

/**
 * 追加一个块，返回**新块的 id**（拿不到则 null）。
 *
 * 注意：用 markdown 追加 `- [ ] x` 时，返回的是外层**列表容器**（`l/t`）的 id，
 * 任务项本身是它的子块。需要任务项 id 的调用方请用 `appendTaskItem`。
 */
export async function appendBlockReturningId(parentID: string, markdown: string): Promise<string | null> {
    const d = await call<unknown>("/api/block/appendBlock", { parentID, dataType: "markdown", data: markdown });
    const arr = Array.isArray(d) ? d : [];
    for (const op of arr) {
        const id = (op as { id?: string })?.id;
        if (id) {
            return id;
        }
    }
    return null;
}

/**
 * 在文档末尾新建一条任务，返回**任务项**（`i/t`）的 id。
 *
 * appendBlock 给的是列表容器 id，所以要再查一次它的任务项子块。
 */
export async function appendTaskItem(docId: string, title: string): Promise<string | null> {
    const container = await appendBlockReturningId(docId, `- [ ] ${(title ?? "").trim()}`);
    if (!container) {
        return null;
    }
    const rows = await runSql<{ id: string }>(
        `select id from blocks where parent_id='${container}' and type='i' and subtype='t' limit 1`,
    );
    return rows[0]?.id ?? null;
}

/** 任务的正文段落（排除装标题的那个内层段落） */
export async function getTaskBody(taskBlockId: string): Promise<BodyBlock[]> {
    const titleId = await firstInnerParagraph(taskBlockId);
    const rows = await runSql<{ id: string; type: string; subtype: string; text: string; sort: number }>(
        `select id, type, subtype, markdown as text, sort from blocks
         where parent_id='${taskBlockId}' and type='p' order by sort`,
    );
    return bodyBlocks(rows.map((r) => ({ id: r.id, type: r.type, subtype: r.subtype, text: r.text })), titleId);
}

/** 往任务的正文里追加一段（落在子任务列表**之前** —— appendBlock 的行为已实测） */
export async function appendTaskBody(taskBlockId: string, text: string): Promise<void> {
    await appendBlock(taskBlockId, (text ?? "").trim());
}

/** 改一段正文 */
export async function updateTaskBody(blockId: string, text: string): Promise<void> {
    await updateBlockMarkdown(blockId, (text ?? "").trim() || " ");
}

/** 删一段正文 */
export async function deleteTaskBody(blockId: string): Promise<void> {
    await deleteBlock(blockId);
}

/**
 * 取「任务标题」。
 *
 * ★ 任务 = 文档 → 标题就是**文档标题**（`blocks.content`），
 *   **不能**去读 kramdown 首行：那会读到文档正文里的第一个块（真机踩到，
 *   标题显示成了 `# 树任务-父`）。
 * 老模型的 `- [ ]` 块才需要从 kramdown 首行解析。
 */
export async function getTaskTitle(id: string): Promise<string> {
    const rows = await runSql<{ type: string; content: string | null }>(
        `select type, content from blocks where id='${id}' limit 1`,
    );
    const row = rows[0];
    if (row?.type === "d") {
        return (row.content ?? "").trim();
    }
    const kr = await getBlockKramdown(id);
    const first = kr.split("\n", 1)[0];
    const m = /^(-\s+(?:\{:[^}]*\}\s*)?)(\[ \]|\[[xX]\])/.exec(first);
    return (m ? first.slice(m[0].length) : first).trim();
}
