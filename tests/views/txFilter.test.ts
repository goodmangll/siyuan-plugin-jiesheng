import { describe, expect, it } from "vitest";
import { isTaskDataChange } from "../../src/views/txFilter";

const TX = (ops: unknown[]) => ({ cmd: "transactions", data: [{ doOperations: ops }] });
const upd = (nw: Record<string, string>, old: Record<string, string> = {}) =>
    ({ action: "updateAttrs", id: "doc1", data: { new: nw, old } });

describe("内核推送过滤：只有任务数据真的变了才重载", () => {
    it("插件重载通知 → 不重载（这就是静置时白烧的那批）", () => {
        expect(isTaskDataChange({ cmd: "reloadPlugin", data: { reloadPlugins: [] } })).toBe(false);
    });

    it("后台任务进度 → 不重载", () => {
        expect(isTaskDataChange({ cmd: "backgroundtask", data: { tasks: [] } })).toBe(false);
    });

    it("同步状态 → 不重载", () => {
        expect(isTaskDataChange({ cmd: "syncEnd", data: {} })).toBe(false);
    });

    it("空/畸形 payload → 不重载（别因此抛异常）", () => {
        expect(isTaskDataChange(null)).toBe(false);
        expect(isTaskDataChange(undefined)).toBe(false);
        expect(isTaskDataChange({})).toBe(false);
        expect(isTaskDataChange({ cmd: "transactions" })).toBe(false);
    });

    it("改了 custom-pri → 重载", () => {
        expect(isTaskDataChange(TX([upd({ "custom-pri": "3" }, { "custom-pri": "2" })]))).toBe(true);
    });

    it("改了 custom-done → 重载（勾选完成）", () => {
        expect(isTaskDataChange(TX([upd({ "custom-done": "202609270000" }, {})]))).toBe(true);
    });

    it("改了 tags → 重载", () => {
        expect(isTaskDataChange(TX([upd({ tags: "a,b" })]))).toBe(true);
    });

    it("只在任务文档里写正文 → 不重载（视图不显示正文）", () => {
        expect(isTaskDataChange(TX([{ action: "update", id: "p1", data: {} }]))).toBe(false);
    });

    it("新建文档 → 重载（可能是新任务）", () => {
        expect(isTaskDataChange(TX([{ action: "create", id: "doc2", data: {} }]))).toBe(true);
    });

    it("删除 / 移动文档 → 重载（任务会消失或换清单）", () => {
        expect(isTaskDataChange(TX([{ action: "delete", id: "doc2" }]))).toBe(true);
        expect(isTaskDataChange(TX([{ action: "move", id: "doc2" }]))).toBe(true);
    });

    it("一批操作里只要有一个相关就重载", () => {
        expect(isTaskDataChange(TX([
            { action: "update", id: "p1", data: {} },
            upd({ "custom-due": "20260930" }),
        ]))).toBe(true);
    });

    it("结构不认识（没有 doOperations）→ 保守重载", () => {
        expect(isTaskDataChange({ cmd: "transactions", data: [{ 别的: 1 }] })).toBe(true);
    });
});

describe("除 transactions 外还要认的两个精确信号", () => {
    it("文档改名（rename）→ 重载：视图里显示的标题要跟上", () => {
        expect(isTaskDataChange({ cmd: "rename", data: { id: "doc1", path: "/x.sy" } })).toBe(true);
    });

    it("索引提交（databaseIndexCommit）→ 重载：这正是「SQL 追上写入」的时刻", () => {
        expect(isTaskDataChange({ cmd: "databaseIndexCommit", data: { rootIDs: ["doc1"] } })).toBe(true);
    });

    it("其余命令一律不认（静置时白烧的就是这些）", () => {
        expect(isTaskDataChange({ cmd: "reloadPlugin", data: {} })).toBe(false);
        expect(isTaskDataChange({ cmd: "backgroundtask", data: { tasks: [] } })).toBe(false);
        expect(isTaskDataChange({ cmd: "syncEnd", data: {} })).toBe(false);
        expect(isTaskDataChange({ cmd: "historyCommit", data: {} })).toBe(false);
    });
});
