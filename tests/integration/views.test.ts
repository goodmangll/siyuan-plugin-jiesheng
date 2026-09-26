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
import { boardSql, calendarSql, countSql, countsFromRow, countsSql, doneSql, listSql, listWithCountsSql, smartListIds } from "../../src/views/query";
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

/**
 * ⚠️ 这些用例的超时给到 20 秒，不是随手放大：
 * `setAttrsAndWait` 只保证「等到 SQL 可见就走了」，而思源的属性写入对 SQL
 * 有 **约 2.5 秒**的可见延迟（实测 2495~2687ms）。一个用例里写两次属性
 * 就要等两轮，默认 5 秒必然超时 —— 之前那 3 条红就是这么来的，
 * 会被误读成「功能坏了」。
 */
describe.skipIf(!reachable)("V-INT 文档模型：每条视图 SQL 都能被内核执行", () => {
    it("5 个智能清单的列表与计数 SQL 全部可执行", async () => {
        for (const id of smartListIds()) {
            const rows = await runSql<TaskRow>(listSql(id, { today: TODAY }));
            expect(Array.isArray(rows)).toBe(true);
            const c = await runSql<{ c: number }>(countSql(id, { today: TODAY }));
            expect(typeof c[0]?.c).toBe("number");
        }
    });

    it("countsSql：一条 SQL 拿 6 个数字，且**真的能执行**", async () => {
        // ★ 这一条是补的：`as all` 是 SQL 保留字，字符串断言全绿、
        //   真机一打开就 `near "all": syntax error`。SQL 必须真跑一遍。
        const rows = await runSql<Record<string, number>>(countsSql({ today: TODAY }));
        expect(rows).toHaveLength(1);
        for (const id of smartListIds()) {
            expect(typeof rows[0][id]).toBe("number");
        }
    });

    it("listWithCountsSql：列表与数字一条 SQL、**真的能执行**，且列表为空也拿得到数字", async () => {
        // 「列表为空但仍要数字」是 `left join ... on 1=1` 那个技巧的用途 ——
        // 不这么写，空列表时一行都不返回，数字就丢了
        for (const v of ["all", "today", "done", "board"]) {
            const rows = await runSql<TaskRow & Record<string, unknown>>(
                listWithCountsSql(v, TODAY),
            );
            expect(rows.length, v).toBeGreaterThanOrEqual(1);
            const c = countsFromRow(rows[0]);
            for (const id of smartListIds()) {
                expect(typeof c[id], `${v}.${id}`).toBe("number");
            }
            // 列表行里 cnt_* 之外的才是任务行；空列表时 id 为空
            const real = rows.filter((r) => r.id);
            expect(real.length).toBe(rows.length - (rows[0].id ? 0 : 1));
        }
    });

    it("listWithCountsSql 的数字与独立 countsSql 一致", async () => {
        const rows = await runSql<Record<string, unknown>>(listWithCountsSql("all", TODAY));
        const mine = countsFromRow(rows[0]);
        const alone = (await runSql<Record<string, number>>(countsSql({ today: TODAY })))[0];
        for (const id of smartListIds()) {
            expect(mine[id], id).toBe(Number(alone[id] ?? 0));
        }
    });

    it("countsSql 与逐条 countSql 结果一致（同源，不能各算各的）", async () => {
        const one = (await runSql<Record<string, number>>(countsSql({ today: TODAY })))[0];
        for (const id of smartListIds()) {
            const rows = await runSql<{ c: number }>(countSql(id, { today: TODAY }));
            expect(one[id]).toBe(rows[0]?.c ?? 0);
        }
    });

    it("看板 / 日历 / 已完成 SQL 全部可执行", async () => {
        expect(Array.isArray(await runSql(boardSql({ today: TODAY })))).toBe(true);
        expect(Array.isArray(await runSql(calendarSql("20200101", "20300101")))).toBe(true);
        expect(Array.isArray(await runSql(doneSql("20200101", "20300101")))).toBe(true);
    });

    it("**只有被标记的文档才算任务** —— 普通文档不能混进来", async () => {
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const mine = toViewTasks(rows, TODAY).filter((t) => t.path.startsWith(`/${PREFIX}-`));
        const titles = mine.map((t) => t.title);
        expect(titles).toContain(`${PREFIX}-甲`);
        expect(titles).toContain(`${PREFIX}-乙`);
        expect(titles).not.toContain(`${PREFIX}-丙`);
    });

    it("标题真的读得到（文档标题在 content 里，不是空）", async () => {
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const hit = toViewTasks(rows, TODAY).find((t) => t.id === taskDoc);
        expect(hit?.title, "读不到文档标题 —— 可能是取错了字段").toBeTruthy();
    });

    it("★ 文档标题来自**路径**，不是正文里的 `# 标题`", async () => {
        // 这条把真机行为钉住：createDocWithMd(notebook, path, markdown) 的标题
        // 取的是 path 的最后一段；markdown 里的 `# 视图任务甲` 只是正文的第一个块，
        // **不会**变成文档标题。
        // 反过来的坑是 `exportMdContent` —— 导出时思源会**自动补一个标题 h1**，
        // 所以 cleanDocBody 必须把它剥掉（见 model/body.ts）。
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const hit = toViewTasks(rows, TODAY).find((t) => t.id === taskDoc);
        expect(hit?.title).toBe(`${PREFIX}-甲`);
        expect(hit?.title).not.toBe("视图任务甲");
    });

    it("属性真的读得出来，且能进「今天」", { timeout: 20_000 }, async () => {
        await setAttrsAndWait(taskDoc, { "custom-due": TODAY, "custom-pri": "1" }, "custom-pri", "1");
        const rows = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        const hit = rows.find((r) => r.id === taskDoc);
        expect(hit, "设了今天的 due 之后，应该出现在「今天」里").toBeTruthy();
        expect(hit!.pri).toBe("1");
    });

    it("**完成状态走 custom-done**：写了就不在未完成里，去已完成里", { timeout: 20_000 }, async () => {
        await setAttrsAndWait(taskDoc, { "custom-done": `${TODAY}1200` }, "custom-done", `${TODAY}1200`);

        const open = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        expect(open.some((r) => r.id === taskDoc), "已完成的不该出现在未完成里").toBe(false);

        const done = await runSql<TaskRow>(doneSql("20200101", "20300101"));
        expect(done.some((r) => r.id === taskDoc), "已完成的该出现在已完成里").toBe(true);

        // 还原
        await setAttrsAndWait(taskDoc, { "custom-done": "" }, "custom-done", "");
    });

    it("「今天」包含已逾期", { timeout: 20_000 }, async () => {
        const b = docs[1];
        await setAttrsAndWait(b, { "custom-due": "20200101" }, "custom-due", "20200101");
        const rows = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        const hit = toViewTasks(rows, TODAY).find((t) => t.id === b);
        expect(hit, "逾期的任务应出现在「今天」").toBeTruthy();
        expect(hit!.overdue).toBe(true);
        await setAttrsAndWait(b, { "custom-due": "" }, "custom-due", "");
    });
});
