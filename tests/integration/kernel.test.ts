/**
 * 集成测试：对**真实思源内核**跑。
 *
 * 不进 CI —— 需要本机有思源在 127.0.0.1:6807 且 token 在 ~/.config/siyuan/api-token。
 * 内核不可达时整组跳过。
 *
 *   pnpm test:int
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
    createDocWithMd, getBlockKramdown, getTaskAttrs, firstInnerParagraph,
    isSubtaskBlock, isTaskBlock, removeDocByID, setBlockAttrs, setTransport, updateBlockMarkdown,
} from "../../src/api/blocks";
import { ATTR, toMeta } from "../../src/model/attrs";
import { isDone, setTaskDone } from "../../src/model/task";

const API = "http://127.0.0.1:6807";
const TOKEN_FILE = join(homedir(), ".config/siyuan/api-token");
let NB = ""; 
const PATH = "/__taskflow_it__";

let reachable = false;
let docId: string | null = null;

async function kernel(url: string, data?: Record<string, unknown>) {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    const r = await fetch(API + url, {
        method: "POST",
        headers: { Authorization: "Token " + token, "Content-Type": "application/json" },
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

beforeAll(async () => {
    try {
        const probe = await fetch(API + "/api/system/version");
        reachable = probe.ok;
    } catch {
        reachable = false;
    }
    if (!reachable || !existsSync(TOKEN_FILE)) {
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
        "  {: custom-pri=\"1\"}",
        "",
        "  正文段落。",
        "",
        "  - [ ] 子任务甲",
        "- [ ] 未受影响的邻居",
        "",
    ].join("\n"));
});

afterAll(async () => {
    if (docId) {
        await removeDocByID(docId);
    }
});

const guard = () => (reachable && docId ? it : it.skip);

describe("I1 属性写入与读回", () => {
    guard()("setBlockAttrs → getTaskAttrs 一致", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
        ));
        expect(rows.length).toBe(1);
        const taskId = rows[0].id;

        await setBlockAttrs(taskId, { [ATTR.due]: "202609251430", [ATTR.pri]: "2" });
        const attrs = await getTaskAttrs(taskId);
        expect(attrs[ATTR.due]).toBe("202609251430");
        expect(attrs[ATTR.pri]).toBe("2");
        expect(toMeta(attrs).pri).toBe("medium");
    });

    guard()("markdown 手写 ial 的属性落在内层段落块，getTaskAttrs 仍能读到（双宿主）", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
        ));
        const taskId = rows[0].id;
        const inner = await firstInnerParagraph(taskId);
        expect(inner).not.toBeNull();
        // 上一条用例把属性写在列表项块上，这里显式不给 innerId，验证合并逻辑没把它弄丢
        const merged = await getTaskAttrs(taskId);
        expect(merged[ATTR.pri]).toBe("2");
    });
});

describe("I2 完成状态切换不损坏子块", () => {
    guard()("切到已完成 → 子块 ID / 内容 / 邻居全部不变", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
        ));
        const taskId = rows[0].id;

        const kidsBefore = await sql<{ id: string; content: string }>(
            `select id, content from blocks where parent_id='${taskId}'
                or parent_id in (select id from blocks where parent_id='${taskId}') order by id`,
        );
        expect(kidsBefore.length).toBeGreaterThan(0);

        const kr = await getBlockKramdown(taskId);
        expect(isDone(kr)).toBe(false);
        await updateBlockMarkdown(taskId, setTaskDone(kr, true)!);
        await new Promise((r) => setTimeout(r, 1500));

        const krAfter = await getBlockKramdown(taskId);
        expect(isDone(krAfter)).toBe(true);

        const kidsAfter = await sql<{ id: string; content: string }>(
            `select id, content from blocks where parent_id='${taskId}'
                or parent_id in (select id from blocks where parent_id='${taskId}') order by id`,
        );
        expect(kidsAfter.map((k) => k.id)).toEqual(kidsBefore.map((k) => k.id));
        expect(kidsAfter.map((k) => k.content)).toEqual(kidsBefore.map((k) => k.content));

        // 邻居不受影响
        const neighbor = await sql<{ markdown: string }>(
            `select markdown from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%邻居%'`,
        );
        expect(neighbor[0].markdown.startsWith("- [ ]")).toBe(true);
    });

    guard()("切回未完成也无损", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
        ));
        const taskId = rows[0].id;
        const kr = await getBlockKramdown(taskId);
        await updateBlockMarkdown(taskId, setTaskDone(kr, false)!);
        await new Promise((r) => setTimeout(r, 1500));
        expect(isDone(await getBlockKramdown(taskId))).toBe(false);
    });
});

describe("I3 块层级判定", () => {
    guard()("顶层任务不是子任务", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%集成任务%'`,
        ));
        expect(await isTaskBlock(rows[0].id)).toBe(true);
        expect(await isSubtaskBlock(rows[0].id)).toBe(false);
    });

    guard()("嵌套任务项被判定为子任务", async () => {
        const rows = await waitFor(() => sql<{ id: string }>(
            `select id from blocks where root_id='${docId}' and type='i' and subtype='t' and content like '%子任务甲%'`,
        ));
        expect(rows.length).toBe(1);
        expect(await isSubtaskBlock(rows[0].id)).toBe(true);
    });
});
