import { describe, expect, it } from "vitest";
import { buildTree, depthOf, parentPathOf, pathNameOf, type TreeInput } from "../../src/views/tree";

const t = (id: string, path: string, extra: Partial<TreeInput> = {}): TreeInput =>
    ({ id, path, ...extra });

describe("T1 从 hpath 算层级（思源的文档树靠 hpath，不是 parent_id —— 实测确认）", () => {
    it("顶层文档深度 1", () => {
        expect(depthOf("/工作")).toBe(1);
    });
    it("子文档深度 2、孙文档深度 3", () => {
        expect(depthOf("/工作/周报")).toBe(2);
        expect(depthOf("/工作/周报/九月")).toBe(3);
    });
    it("路径名 = 最后一段", () => {
        expect(pathNameOf("/工作/周报/九月")).toBe("九月");
        expect(pathNameOf("/工作")).toBe("工作");
    });
    it("父路径", () => {
        expect(parentPathOf("/工作/周报/九月")).toBe("/工作/周报");
        expect(parentPathOf("/工作")).toBe("");
    });
    it("异常输入不崩", () => {
        expect(depthOf("")).toBe(0);
        expect(pathNameOf("")).toBe("");
        expect(parentPathOf("")).toBe("");
    });
});

describe("T2 还原成树（父在前、子紧随、带深度）", () => {
    it("子文档紧跟父文档，并标出深度", () => {
        const tree = buildTree([
            t("B", "/工作"), t("C", "/工作/周报"), t("D", "/生活"),
        ]);
        expect(tree.map((n) => [n.task.id, n.depth])).toEqual([["B", 1], ["C", 2], ["D", 1]]);
    });
    it("三级递归也有序", () => {
        const tree = buildTree([
            t("A", "/a"), t("B", "/a/b"), t("C", "/a/b/c"), t("D", "/d"),
        ]);
        expect(tree.map((n) => n.task.id)).toEqual(["A", "B", "C", "D"]);
    });
    it("**父任务不在列表里时，子任务照样出现**（否则「今天」会漏掉子任务）", () => {
        const tree = buildTree([t("C", "/工作/周报")]);
        expect(tree.map((n) => n.task.id)).toEqual(["C"]);
        expect(tree[0].depth).toBe(2);
    });
    it("孤儿按路径插到正确位置（按路径字典序）", () => {
        const tree = buildTree([t("D", "/z"), t("A", "/a"), t("B", "/a/b")]);
        expect(tree.map((n) => n.task.id)).toEqual(["A", "B", "D"]);
    });
    it("同一父下的兄弟顺序稳定（同路径按传入顺序）", () => {
        const tree = buildTree([t("X", "/a"), t("Y", "/a")]);
        expect(tree.map((n) => n.task.id)).toEqual(["X", "Y"]);
    });
    it("空输入 → 空数组", () => {
        expect(buildTree([])).toEqual([]);
    });
});

describe("T3 子任务计数与折叠", () => {
    it("算出每个节点有几个直属子任务", () => {
        const tree = buildTree([t("A", "/a"), t("B", "/a/b"), t("C", "/a/c"), t("D", "/a/b/d")]);
        const byId = Object.fromEntries(tree.map((n) => [n.task.id, n.childCount]));
        expect(byId.A).toBe(2);
        expect(byId.B).toBe(1);
        expect(byId.C).toBe(0);
        expect(byId.D).toBe(0);
    });
    it("折叠某个节点 → **它的所有后代**都隐藏（不只直属子节点）", () => {
        const all = [t("A", "/a"), t("B", "/a/b"), t("C", "/a/b/c"), t("D", "/a/d")];
        expect(buildTree(all).map((n) => n.task.id)).toEqual(["A", "B", "C", "D"]);
        // 折 A → B、C、D 全在 A 的子树里，一起隐藏
        expect(buildTree(all, new Set(["A"])).map((n) => n.task.id)).toEqual(["A"]);
        // 折 B → 只隐藏 C，A 与 D 还在
        expect(buildTree(all, new Set(["B"])).map((n) => n.task.id)).toEqual(["A", "B", "D"]);
    });
    it("折叠的是深层节点时，同层的兄弟不受影响", () => {
        const all = [t("A", "/a"), t("B", "/a/b"), t("C", "/a/b/c"), t("D", "/a/d")];
        expect(buildTree(all, new Set(["C"])).map((n) => n.task.id)).toEqual(["A", "B", "C", "D"]);
    });
    it("折叠默认是展开的", () => {
        const tree = buildTree([t("A", "/a"), t("B", "/a/b")]);
        expect(tree.every((n) => n.collapsed === false)).toBe(true);
    });
});

describe("T4 只显示顶层 / 显示全部", () => {
    it("只看顶层：父路径不在任务里的那些", () => {
        const tree = buildTree([t("A", "/a"), t("B", "/a/b"), t("D", "/d")]);
        expect(tree.filter((n) => n.depth === 1).map((n) => n.task.id)).toEqual(["A", "D"]);
    });
    it("子任务的父路径能被算出来（用于判断它是不是子任务）", () => {
        const tree = buildTree([t("B", "/a/b")]);
        expect(tree[0].parentPath).toBe("/a");
    });
});
