/**
 * 视图层 SQL 的集成测试：**每条 SQL 都真的丢给内核执行一遍**。
 *
 * 为什么必须有这一组：单测只能断言"SQL 字符串里有没有这段"，
 * 而 SQL 是**会被真的执行**的东西 —— 曾经 17 条单测全绿，
 * 真机上 Tab 一打开却是 `no such column: b.due`。
 *
 * ★ 模型：**任务 = 文档**。测试因此建的是文档，不是 - [ ] 块。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    createDocWithMd, removeDocByID, runSql, setTransport,
} from "../../src/api/blocks";
import { setAttrsAndWait } from "../../src/api/views";
import { boardSql, calendarSql, countSql, doneSql, listSql, smartListIds } from "../../src/views/query";
import { toViewTasks, type TaskRow } from "../../src/views/model";

const API = "http://127.0.0.1:6807";
const TOKEN_FILE = join(homedir(), ".config/siyuan/api-token");
let NB = "";
const PREFIX = "__jiesheng_viewdoc__";
const TOKEN = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : null;

let reachable = false;
if (TOKEN) {
    try {
        const res = await fetch(`${API}/api/query/sql`, {
            method: "POST",
            headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ stmt: "select 1" }),
        });
        reachable = res.ok;
    } catch {
        reachable = false;
    }
}
if (!reachable) {
    console.warn("[views:int] 内核不可达，跳过（启动思源后重跑）");
}

setTransport(async (url, data) => {
    const res = await fetch(API + url, {
        method: "POST",
        headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(data ?? {}),
    });
    return (await res.json()) as { code: number; msg?: string; data: unknown };
});

const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const docs: string[] = [];
let taskDoc = "";

async function mkDoc(name: string, body: string): Promise<string> {
    const id = await createDocWithMd(NB, `/${PREFIX}-${name}`, body);
    expect(id, `建文档 ${name} 失败`).toBeTruthy();
    docs.push(id!);
    return id!;
}

beforeAll(async () => {
    if (!reachable) return;
    const a = await mkDoc("甲", "# 视图任务甲\n\n正文。\n");
    const b = await mkDoc("乙", "# 视图任务乙\n\n- [ ] 子步骤一\n");
    await mkDoc("丙", "# 视图任务丙（非任务）\n");
    taskDoc = a;
    // 只有甲、乙被标记为任务；丙保持普通文档
    for (const id of [a, b]) {
        await setAttrsAndWait(id, { "custom-task": "1" }, "custom-task", "1");
    }
    await waitForIndex(2);
});

async function waitForIndex(want: number): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const rows = await runSql<{ c: number }>(
            `select count(*) c from attributes where name='custom-task' and value='1' and block_id in (select id from blocks where hpath like '/${PREFIX}-%')`,
        );
        if ((rows[0]?.c ?? 0) >= want) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("等待索引超时");
}

afterAll(async () => {
    for (const id of docs) {
        await removeDocByID(id).catch(() => undefined);
    }
});

describe.skipIf(!reachable)("V-INT 文档模型：每条视图 SQL 都能被内核执行", () => {
    it("5 个智能清单的列表与计数 SQL 全部可执行", async () => {
        for (const id of smartListIds()) {
            const rows = await runSql<TaskRow>(listSql(id, { today: TODAY }));
            expect(Array.isArray(rows)).toBe(true);
            const c = await runSql<{ c: number }>(countSql(id, { today: TODAY }));
            expect(typeof c[0]?.c).toBe("number");
        }
    });

    it("看板 / 日历 / 已完成 SQL 全部可执行", async () => {
        expect(Array.isArray(await runSql(boardSql({ today: TODAY })))).toBe(true);
        expect(Array.isArray(await runSql(calendarSql("20200101", "20300101")))).toBe(true);
        expect(Array.isArray(await runSql(doneSql("20200101", "20300101")))).toBe(true);
    });

    it("**只有被标记的文档才算任务** —— 普通文档不能混进来", async () => {
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const titles = toViewTasks(rows, TODAY).map((t) => t.title);
        expect(titles).toContain("视图任务甲");
        expect(titles).toContain("视图任务乙");
        expect(titles).not.toContain("视图任务丙（非任务）");
    });

    it("标题真的读得到（文档标题在 content 里，不是空）", async () => {
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const hit = toViewTasks(rows, TODAY).find((t) => t.title === "视图任务甲");
        expect(hit, "读不到文档标题 —— 可能是取错了字段").toBeTruthy();
    });

    it("属性真的读得出来，且能进「今天」", async () => {
        await setAttrsAndWait(taskDoc, { "custom-due": TODAY, "custom-pri": "1" }, "custom-pri", "1");
        const rows = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        const hit = rows.find((r) => r.id === taskDoc);
        expect(hit, "设了今天的 due 之后，应该出现在「今天」里").toBeTruthy();
        expect(hit!.pri).toBe("1");
    });

    it("**完成状态走 custom-done**：写了就不在未完成里，去已完成里", async () => {
        await setAttrsAndWait(taskDoc, { "custom-done": `${TODAY}1200` }, "custom-done", `${TODAY}1200`);

        const open = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        expect(open.some((r) => r.id === taskDoc), "已完成的不该出现在未完成里").toBe(false);

        const done = await runSql<TaskRow>(doneSql("20200101", "20300101"));
        expect(done.some((r) => r.id === taskDoc), "已完成的该出现在已完成里").toBe(true);

        // 还原
        await setAttrsAndWait(taskDoc, { "custom-done": "" }, "custom-done", "");
    });

    it("「今天」包含已逾期（同类产品的默认行为）", async () => {
        const b = docs[1];
        await setAttrsAndWait(b, { "custom-due": "20200101" }, "custom-due", "20200101");
        const rows = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        const hit = toViewTasks(rows, TODAY).find((t) => t.id === b);
        expect(hit, "逾期的任务应出现在「今天」").toBeTruthy();
        expect(hit!.overdue).toBe(true);
        await setAttrsAndWait(b, { "custom-due": "" }, "custom-due", "");
    });
});
