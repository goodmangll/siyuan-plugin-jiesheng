/**
 * 视图层 SQL 的集成测试：**每条 SQL 都真的丢给内核执行一遍**。
 *
 * 为什么必须有这一组：单测只能断言"SQL 字符串里有没有这段"，
 * 而 SQL 是**会被真的执行**的东西 —— 曾经 17 条单测全绿，
 * 真机上 Tab 一打开却是 `no such column: b.due`。
 * 断言字符串永远发现不了这种事，只有真跑一遍才发现得了。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocWithMd, removeDocByID, runSql, setTransport } from "../../src/api/blocks";
import { setAttrsAndWait } from "../../src/api/views";
import { boardSql, calendarSql, countSql, listSql, smartListIds } from "../../src/views/query";
import { toViewTasks, type TaskRow } from "../../src/views/model";

const API = "http://127.0.0.1:6807";
const TOKEN_FILE = join(homedir(), ".config/siyuan/api-token");
let NB = "";
const PATH = "/__taskflow_views__";
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
    console.warn("[views:int] 内核不可达，跳过（设 SIYUAN_API_TOKEN 或启动思源后重跑）");
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
let docId = "";

beforeAll(async () => {
    if (!reachable) {
        return;
    }
    docId = (await createDocWithMd(
        NB, PATH,
        "# 视图集成测试\n\n- [ ] 视图任务甲\n\n- [ ] 视图任务乙\n\n- [ ] 父任务\n  - [ ] 子任务甲\n",
    )) ?? "";
    expect(docId).toBeTruthy();
    // 思源的索引是**异步**的：刚建完文档立刻查，块可能还没进 blocks 表。
    // 不轮询的话测试会随机失败，而且失败原因看着像"SQL 写错了"，非常误导。
    await waitForBlock();
});

/** 轮询等待文档里的块真的可查（最多 10 秒） */
async function waitForBlock(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const rows = await runSql<{ c: number }>(
            `select count(*) as c from blocks where root_id='${docId}' and type='i' and subtype='t'`,
        );
        if ((rows[0]?.c ?? 0) >= 3) {
            return;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("等待索引超时：文档里的任务块一直查不到");
}

afterAll(async () => {
    if (docId) {
        await removeDocByID(docId).catch(() => undefined);
    }
});

describe.skipIf(!reachable)("V-INT 每条视图 SQL 都能被内核执行", () => {
    it("5 个智能清单的列表 SQL 全部可执行", async () => {
        for (const id of smartListIds()) {
            const rows = await runSql<TaskRow>(listSql(id, { today: TODAY }));
            expect(Array.isArray(rows)).toBe(true);
        }
    });

    it("5 个智能清单的计数 SQL 全部可执行，且返回数字", async () => {
        for (const id of smartListIds()) {
            const rows = await runSql<{ c: number }>(countSql(id, { today: TODAY }));
            expect(typeof rows[0]?.c).toBe("number");
        }
    });

    it("看板 SQL 可执行", async () => {
        expect(Array.isArray(await runSql(boardSql({ today: TODAY })))).toBe(true);
    });

    it("日历 SQL 可执行", async () => {
        expect(Array.isArray(await runSql(calendarSql("20260101", "20270101")))).toBe(true);
    });

    it("**子任务必须被排除**（真数据验证，不是字符串断言）", async () => {
        const rows = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const titles = toViewTasks(rows, TODAY).map((t) => t.title);
        expect(titles).toContain("视图任务甲");
        expect(titles).not.toContain("子任务甲");
    });

    it("属性真的读得出来（due/pri 有值，而不是永远 null）", async () => {
        const list = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const target = list.find((r) => (r.markdown ?? "").includes("视图任务甲"));
        expect(target).toBeTruthy();
        // ⚠️ 必须等写入可见：思源的属性写入对 SQL 有约 1 秒的可见性延迟
        await setAttrsAndWait(target!.id, { "custom-due": TODAY, "custom-pri": "1" }, "custom-pri", "1");

        const after = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        const hit = after.find((r) => r.id === target!.id);
        expect(hit, "设了今天的 due 之后，应该出现在「今天」里").toBeTruthy();
        expect(hit!.due).toBe(TODAY);
        expect(hit!.pri).toBe("1");
    });

    it("「今天」包含已逾期（同类产品的默认行为）", async () => {
        const list = await runSql<TaskRow>(listSql("all", { today: TODAY }));
        const target = list.find((r) => (r.markdown ?? "").includes("视图任务乙"));
        expect(target).toBeTruthy();
        // 设成很久以前
        await setAttrsAndWait(target!.id, { "custom-due": "20200101" }, "custom-due", "20200101");

        const today = await runSql<TaskRow>(listSql("today", { today: TODAY }));
        expect(today.some((r) => r.id === target!.id), "逾期的任务应出现在「今天」").toBe(true);
        expect(toViewTasks(today, TODAY).find((t) => t.id === target!.id)!.overdue).toBe(true);
    });
});
