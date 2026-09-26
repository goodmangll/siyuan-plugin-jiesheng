/**
 * 集成测试：对**真实思源内核**跑（不进 CI）。
 *
 *   pnpm test:int
 *
 * 依赖：本机思源在 127.0.0.1:6807，且 token 在 ~/.config/siyuan/api-token。
 * 内核不可达时整组跳过，并打印跳过原因（不静默）。
 * 会在一个打开的笔记本里建临时文档 `/__jiesheng_it__`，跑完删掉。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    createDocWithMd, firstInnerParagraph, getBlockKramdown, getTaskAttrs,
    isSubtaskBlock, isTaskBlock, removeDocByID, setBlockAttrs, setTransport, updateBlockMarkdown,
} from "../../src/api/blocks";
import { ATTR, toMeta } from "../../src/model/attrs";
import { isDone, setTaskDone } from "../../src/model/task";

const API = "http://127.0.0.1:6807";
const TOKEN_FILE = join(homedir(), ".config/siyuan/api-token");
let NB = "";
const PATH = "/__jiesheng_it__";

const TOKEN = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : null;

// 可达性必须在**模块加载期**确定，否则 skipIf 在收集阶段就是 false
let reachable = false;
if (!TOKEN) {
    console.warn(`[integration] 跳过：找不到 ${TOKEN_FILE}`);
} else {
    try {
        const probe = await fetch(API + "/api/system/version", { headers: { Authorization: "Token " + TOKEN } });
        const body = (await probe.json()) as { code?: number; data?: string };
        if (probe.ok && body.code === 0) {
            NB = await pickNotebook();
            reachable = !!NB;
            console.log(reachable
                ? `[integration] 内核可达，版本 ${body.data}，用笔记本 ${NB}`
                : "[integration] 跳过：工作区里没有打开的笔记本");
        } else {
            console.log(`[integration] 跳过：探测失败 status=${probe.status} body=${JSON.stringify(body).slice(0, 140)}`);
        }
    } catch (e) {
        console.warn(`[integration] 跳过：连不上 ${API} —— ${(e as Error).message}`);
    }
}

let docId: string | null = null;

/**
 * 选一个可用的笔记本。
 *
 * ⚠️ 这里**绝不能写死笔记本 id**：那既是把开发者自己的工作区信息留在公开仓库里，
 *    也让别人 clone 下来根本跑不了（工作区里不会有同一个 id）。
 * 没有可用笔记本时整组跳过，并说明原因（不静默）。
 */
async function pickNotebook(): Promise<string> {
    const res = await fetch(API + "/api/notebook/lsNotebooks", {
        method: "POST",
        headers: { Authorization: "Token " + TOKEN, "Content-Type": "application/json" },
        body: "{}",
    });
    const body = (await res.json()) as { data?: { notebooks?: { id: string; closed?: boolean }[] } };
    return (body.data?.notebooks ?? []).find((n) => !n.closed)?.id ?? "";
}

async function kernel(url: string, data?: Record<string, unknown>) {
    const r = await fetch(API + url, {
        method: "POST",
        headers: { Authorization: "Token " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(data ?? {}),
    });
    return r.json() as Promise<{ code: number; msg?: string; data: unknown }>;
}

async function sql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
    const r = await kernel("/api/query/sql", { stmt });
    return (r.data ?? []) as T[];
}

async function waitFor<T>(fn: () => Promise<T[]>, tries = 30): Promise<T[]> {
    for (let i = 0; i < tries; i++) {
        const rows = await fn();
        if (rows.length) {
            return rows;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return [];
}

const taskRows = () => waitFor(() => sql<{ id: string }>(
    `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
));
const kids = (id: string) => sql<{ id: string; content: string }>(
    `select id, content from blocks where parent_id='${id}'
        or parent_id in (select id from blocks where parent_id='${id}') order by id`,
);

beforeAll(async () => {
    if (!reachable) {
        return;
    }
    setTransport(kernel as never);
    for (const d of await sql<{ id: string }>(`select id from blocks where type='d' and hpath='${PATH}'`)) {
        await removeDocByID(d.id);
    }
    docId = await createDocWithMd(NB, PATH, [
        "# 集成测试",
        "",
        "- [ ] 集成任务",
        '  {: custom-pri="1"}',
        "",
        "  正文段落。",
        "",
        "  - [ ] 子任务甲",
        "- [ ] 未受影响的邻居",
        "",
    ].join("\n"));
    if (!docId) {
        console.warn("[integration] 临时文档创建失败");
    }
}, 60000);

afterAll(async () => {
    if (docId) {
        await removeDocByID(docId);
        console.log("[integration] 临时文档已删除");
    }
});

describe.skipIf(!reachable)("I1 属性写入与读回（真内核）", () => {
    it("setBlockAttrs → getTaskAttrs 一致，且能被 toMeta 解出", async () => {
        const rows = await taskRows();
        expect(rows.length).toBe(1);
        const taskId = rows[0].id;

        await setBlockAttrs(taskId, { [ATTR.due]: "202609251430", [ATTR.pri]: "2" });
        const attrs = await getTaskAttrs(taskId);
        expect(attrs[ATTR.due]).toBe("202609251430");
        expect(attrs[ATTR.pri]).toBe("2");
        expect(toMeta(attrs).pri).toBe("medium");
        expect(toMeta(attrs).due).toBe("202609251430");
    });

    it("双宿主：markdown 手写 ial 落内层段落块，合并读仍拿得到", async () => {
        const rows = await taskRows();
        const taskId = rows[0].id;
        expect(await firstInnerParagraph(taskId)).not.toBeNull();
        expect((await getTaskAttrs(taskId))[ATTR.pri]).toBe("2");
    });
});

describe.skipIf(!reachable)("I2 完成状态切换不损坏子块（真内核）", () => {
    it("切到已完成 → 子块 ID / 内容 / 邻居全部不变", async () => {
        const rows = await taskRows();
        const taskId = rows[0].id;
        const before = await kids(taskId);
        expect(before.length).toBeGreaterThan(0);

        const kr = await getBlockKramdown(taskId);
        expect(isDone(kr)).toBe(false);
        await updateBlockMarkdown(taskId, setTaskDone(kr, true)!);
        await new Promise((r) => setTimeout(r, 1500));

        expect(isDone(await getBlockKramdown(taskId))).toBe(true);
        const after = await kids(taskId);
        expect(after.map((k) => k.id)).toEqual(before.map((k) => k.id));
        expect(after.map((k) => k.content)).toEqual(before.map((k) => k.content));

        const neighbor = await sql<{ markdown: string }>(
            `select markdown from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%邻居%'`,
        );
        expect(neighbor[0].markdown.startsWith("- [ ]")).toBe(true);
    });

    it("切回未完成也无损", async () => {
        const rows = await taskRows();
        const taskId = rows[0].id;
        await updateBlockMarkdown(taskId, setTaskDone(await getBlockKramdown(taskId), false)!);
        await new Promise((r) => setTimeout(r, 1500));
        expect(isDone(await getBlockKramdown(taskId))).toBe(false);
    });
});

describe.skipIf(!reachable)("I3 块层级判定（真内核）", () => {
    it("顶层任务不是子任务", async () => {
        const rows = await taskRows();
        expect(await isTaskBlock(rows[0].id)).toBe(true);
        expect(await isSubtaskBlock(rows[0].id)).toBe(false);
    });

    it("嵌套任务项被判定为子任务", async () => {
        // 注意：思源容器块的 content 包含后代文本，所以「集成任务（父）」也会命中「子任务甲」。
        // 用 not like 把父任务排掉，只留真正的子任务项。
        const rows = await waitFor(() => sql<{ id: string; content: string }>(
            `select id, content from blocks where root_id='${docId}' and type='i' and subtype='t'
               and content like '%子任务甲%' and content not like '%集成任务%'`,
        ));
        expect(rows.length).toBe(1);
        expect(rows[0].content.trim()).toBe("子任务甲");
        expect(await isSubtaskBlock(rows[0].id)).toBe(true);
    });
});
