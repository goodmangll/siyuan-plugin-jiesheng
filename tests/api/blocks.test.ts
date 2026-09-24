import { beforeEach, describe, expect, it } from "vitest";
import {
    firstInnerParagraph, getTaskAttrs, isSubtaskBlock, isTaskBlock, resolveTaskBlock,
    setBlockAttrs, setTransport, type KernelResponse,
} from "../../src/api/blocks";

interface Call { url: string; data?: Record<string, unknown> }
let calls: Call[] = [];
let handler: (url: string, data?: Record<string, unknown>) => KernelResponse | undefined;

function install(h: typeof handler) {
    handler = h;
    setTransport(async (url, data) => {
        calls.push({ url, data });
        return handler(url, data);
    });
}

const ok = (data: unknown): KernelResponse => ({ code: 0, data });

beforeEach(() => {
    calls = [];
    install(() => undefined);
});

describe("transport 与错误处理", () => {
    it("code != 0 → 抛错并带上 msg", async () => {
        install(() => ({ code: -1, msg: "boom" }));
        await expect(setBlockAttrs("A", {})).rejects.toThrow(/boom/);
    });
    it("返回 undefined → 抛错（不静默吞掉）", async () => {
        install(() => undefined);
        await expect(setBlockAttrs("A", {})).rejects.toThrow(/返回异常/);
    });
    it("code=0 但 data 缺失 → 返回空对象而不是崩", async () => {
        install(() => ({ code: 0 }));
        expect(await getTaskAttrs("TASK", null)).toEqual({});
    });
});

describe("A1/A2 双宿主：getTaskAttrs", () => {
    it("内层段落块有、列表项块没有 → 读到内层的", async () => {
        install((url, d) => {
            if (url === "/api/attr/getBlockAttrs") {
                return ok(d!.id === "TASK" ? {} : { "custom-pri": "3" });
            }
            if (url === "/api/query/sql") {
                return ok([{ id: "INNER" }]);
            }
            return ok(null);
        });
        expect(await getTaskAttrs("TASK")).toEqual({ "custom-pri": "3" });
    });
    it("两边都有 → 列表项块优先", async () => {
        install((url, d) => {
            if (url === "/api/attr/getBlockAttrs") {
                return ok(d!.id === "TASK" ? { "custom-pri": "1" } : { "custom-pri": "3", "custom-due": "20260925" });
            }
            if (url === "/api/query/sql") {
                return ok([{ id: "INNER" }]);
            }
            return ok(null);
        });
        expect(await getTaskAttrs("TASK")).toEqual({ "custom-pri": "1", "custom-due": "20260925" });
    });
    it("没有内层段落块 → 只读列表项块，且不多发请求", async () => {
        install((url) => {
            if (url === "/api/attr/getBlockAttrs") {
                return ok({ "custom-due": "20260925" });
            }
            if (url === "/api/query/sql") {
                return ok([]);
            }
            return ok(null);
        });
        const attrs = await getTaskAttrs("TASK");
        expect(attrs).toEqual({ "custom-due": "20260925" });
        expect(calls.filter((c) => c.url === "/api/attr/getBlockAttrs")).toHaveLength(1);
    });
    it("显式传 innerId=null → 跳过内层查询", async () => {
        install((url) => (url === "/api/attr/getBlockAttrs" ? ok({ "custom-pri": "2" }) : ok(null)));
        await getTaskAttrs("TASK", null);
        expect(calls.some((c) => c.url === "/api/query/sql")).toBe(false);
    });
});

describe("取内层段落块", () => {
    it("SQL 里带了 limit 且按 sort 排序", async () => {
        install((url) => (url === "/api/query/sql" ? ok([{ id: "INNER" }]) : ok(null)));
        expect(await firstInnerParagraph("TASK")).toBe("INNER");
        const stmt = String(calls[0].data!.stmt);
        expect(stmt).toContain("parent_id='TASK'");
        expect(stmt).toContain("type='p'");
        expect(stmt).toContain("limit 1");
    });
    it("没有 → null", async () => {
        install((url) => (url === "/api/query/sql" ? ok([]) : ok(null)));
        expect(await firstInnerParagraph("TASK")).toBeNull();
    });
});

describe("任务块判定", () => {
    it("isTaskBlock 查的是 type='i' subtype='t'", async () => {
        install((url) => (url === "/api/query/sql" ? ok([{ id: "T" }]) : ok(null)));
        expect(await isTaskBlock("T")).toBe(true);
        expect(String(calls[0].data!.stmt)).toContain("type='i' and subtype='t'");
    });
    it("isSubtaskBlock：祖父是任务项 → true", async () => {
        install((url) => (url === "/api/query/sql" ? ok([{ ptype: "l", gtype: "i", gsub: "t" }]) : ok(null)));
        expect(await isSubtaskBlock("T")).toBe(true);
    });
    it("isSubtaskBlock：祖父是标题 → false", async () => {
        install((url) => (url === "/api/query/sql" ? ok([{ ptype: "l", gtype: "h", gsub: "h2" }]) : ok(null)));
        expect(await isSubtaskBlock("T")).toBe(false);
    });
    it("isSubtaskBlock：查不到 → false，不抛", async () => {
        install((url) => (url === "/api/query/sql" ? ok([]) : ok(null)));
        expect(await isSubtaskBlock("T")).toBe(false);
    });
});

describe("SQL 只读约束", () => {
    it("所有 SQL 都是 select", async () => {
        install((url) => (url === "/api/query/sql" ? ok([]) : ok(null)));
        await firstInnerParagraph("T");
        await isTaskBlock("T");
        await isSubtaskBlock("T");
        for (const c of calls.filter((c) => c.url === "/api/query/sql")) {
            expect(String(c.data!.stmt).trim().toLowerCase()).toMatch(/^select/);
        }
    });
});

describe("任务块归一化（光标常落在段落块上）", () => {
    it("本身就是任务项 → 原样返回", async () => {
        install((url) => (url === "/api/query/sql" ? ok([{ id: "T", type: "i", subtype: "t", parent_id: "L" }]) : ok(null)));
        expect(await resolveTaskBlock("T")).toBe("T");
    });
    it("段落块 → 向上找到所属任务项", async () => {
        install((url, d) => {
            if (url !== "/api/query/sql") return ok(null);
            const stmt = String(d!.stmt);
            if (stmt.includes("id='P'")) return ok([{ id: "P", type: "p", subtype: "", parent_id: "T" }]);
            if (stmt.includes("id='T'")) return ok([{ id: "T", type: "i", subtype: "t", parent_id: "L" }]);
            return ok([]);
        });
        expect(await resolveTaskBlock("P")).toBe("T");
    });
    it("子任务的段落块 → 找到子任务项，不会跑到父任务", async () => {
        install((url, d) => {
            if (url !== "/api/query/sql") return ok(null);
            const stmt = String(d!.stmt);
            if (stmt.includes("id='SP'")) return ok([{ id: "SP", type: "p", subtype: "", parent_id: "SI" }]);
            if (stmt.includes("id='SI'")) return ok([{ id: "SI", type: "i", subtype: "t", parent_id: "SL" }]);
            return ok([]);
        });
        expect(await resolveTaskBlock("SP")).toBe("SI");
    });
    it("普通段落（不在任务里）→ null", async () => {
        install((url, d) => {
            if (url !== "/api/query/sql") return ok(null);
            const stmt = String(d!.stmt);
            if (stmt.includes("id='P'")) return ok([{ id: "P", type: "p", subtype: "", parent_id: "D" }]);
            if (stmt.includes("id='D'")) return ok([{ id: "D", type: "d", subtype: "", parent_id: "" }]);
            return ok([]);
        });
        expect(await resolveTaskBlock("P")).toBeNull();
    });
    it("块不存在 → null，不抛", async () => {
        install((url) => (url === "/api/query/sql" ? ok([]) : ok(null)));
        expect(await resolveTaskBlock("NOPE")).toBeNull();
    });
});
