import { beforeEach, describe, expect, it } from "vitest";
import {
    COMMANDS, clearDue, currentTaskBlockId, setPriority, setDueTo, toggleDone,
    type TaskCommandDeps,
} from "../src/commands";

const NOW = new Date(2026, 8, 25, 10, 0); // 2026-09-25 周五

let writes: { id: string; patch: Record<string, string> }[] = [];
let krWrites: { id: string; md: string }[] = [];
let toasts: string[] = [];
let store: Record<string, Record<string, string>> = {};
let kramdown: Record<string, string> = {};
let active: string | null = "TASK";

const deps: TaskCommandDeps = {
    now: () => NOW,
    activeTaskBlockId: async () => active,
    readAttrs: async (id) => store[id] ?? {},
    writeAttrs: async (id, patch) => {
        writes.push({ id, patch });
        store[id] = { ...(store[id] ?? {}), ...patch };
    },
    readKramdown: async (id) => kramdown[id] ?? "",
    writeKramdown: async (id, md) => {
        krWrites.push({ id, md });
        kramdown[id] = md;
    },
    openPanel: () => {},
    toast: (m) => toasts.push(m),
};

beforeEach(() => {
    writes = []; krWrites = []; toasts = []; store = {}; kramdown = {}; active = "TASK";
});

describe("T1/T2/T3 优先级", () => {
    it("高 → custom-pri=1", async () => {
        await setPriority(deps, "high");
        expect(writes).toEqual([{ id: "TASK", patch: { "custom-pri": "1" } }]);
    });
    it("中 / 低 → 2 / 3", async () => {
        await setPriority(deps, "medium");
        await setPriority(deps, "low");
        expect(writes.map((w) => w.patch["custom-pri"])).toEqual(["2", "3"]);
    });
    it("T2 无 → 写空串（= 删除属性），不是写 '0'", async () => {
        await setPriority(deps, "none");
        expect(writes).toEqual([{ id: "TASK", patch: { "custom-pri": "" } }]);
    });
});

describe("T4/T5 日期", () => {
    it("设为今天（原为全天 → 保持 8 位）", async () => {
        store["TASK"] = { "custom-due": "20260101" };
        await setDueTo(deps, "today");
        expect(writes[0].patch["custom-due"]).toBe("20260925");
    });
    it("设为今天（原有时刻 → 保持 12 位形态）", async () => {
        store["TASK"] = { "custom-due": "202601011430" };
        await setDueTo(deps, "today");
        expect(writes[0].patch["custom-due"]).toBe("202609251430");
    });
    it("明天 / 下周同一天", async () => {
        store["TASK"] = { "custom-due": "20260925" };
        await setDueTo(deps, "tomorrow");
        await setDueTo(deps, "nextWeek");
        expect(writes.map((w) => w.patch["custom-due"])).toEqual(["20260926", "20261002"]);
    });
    it("T6 清除日期只动 custom-due，不动 custom-start", async () => {
        store["TASK"] = { "custom-due": "20260925", "custom-start": "202609201000" };
        await clearDue(deps);
        expect(writes).toEqual([{ id: "TASK", patch: { "custom-due": "" } }]);
        expect(writes[0].patch).not.toHaveProperty("custom-start");
    });
});

describe("T7 光标不在任务块上", () => {
    it("没有任何写入，且给出提示，不抛异常", async () => {
        active = null;
        await expect(setPriority(deps, "high")).resolves.toBeUndefined();
        expect(writes).toHaveLength(0);
        expect(toasts).toHaveLength(1);
    });
    it("activeTaskBlockId 抛错时也不炸", async () => {
        deps.activeTaskBlockId = async () => { throw new Error("boom"); };
        await expect(setPriority(deps, "high")).resolves.toBeUndefined();
        deps.activeTaskBlockId = async () => active;
    });
});

describe("T14/T15 完成状态", () => {
    it("切到已完成：只改首行标记", async () => {
        kramdown["TASK"] = '- {: id="TASK"}[ ] 标题\n\n  正文\n\n  - [ ] 子任务';
        await toggleDone(deps);
        expect(krWrites).toHaveLength(1);
        expect(krWrites[0].md.split("\n")[0]).toBe('- {: id="TASK"}[X] 标题');
        expect(krWrites[0].md.split("\n").slice(1)).toEqual(
            '- {: id="TASK"}[ ] 标题\n\n  正文\n\n  - [ ] 子任务'.split("\n").slice(1),
        );
    });
    it("已是已完成 → 取消完成", async () => {
        kramdown["TASK"] = "- [X] 标题";
        await toggleDone(deps);
        expect(krWrites[0].md).toBe("- [ ] 标题");
    });
    it("非任务块 → 不写，给提示", async () => {
        kramdown["TASK"] = "普通段落";
        await toggleDone(deps);
        expect(krWrites).toHaveLength(0);
        expect(toasts).toHaveLength(1);
    });
});

describe("命令表与快捷键（方向级验收）", () => {
    it("10 个命令，热键全部落在 Alt+Shift 空间", () => {
        expect(COMMANDS).toHaveLength(10);
        for (const c of COMMANDS) {
            expect(c.hotkeys.length).toBeGreaterThan(0);
            for (const hk of c.hotkeys) {
                expect(hk.startsWith("\u2325\u21e7")).toBe(true); // ⌥⇧
            }
        }
    });
    it("优先级 1/2/3/0", () => {
        const m = Object.fromEntries(COMMANDS.map((c) => [c.langKey, c.hotkeys[0]]));
        expect(m.priorityHigh).toBe("\u2325\u21e71");
        expect(m.priorityMedium).toBe("\u2325\u21e72");
        expect(m.priorityLow).toBe("\u2325\u21e73");
        expect(m.priorityNone).toBe("\u2325\u21e70");
    });
    it("日期 Q/W/E/X + 面板 D + 完成 M（置顶留到 M2）", () => {
        const m = Object.fromEntries(COMMANDS.map((c) => [c.langKey, c.hotkeys[0]]));
        expect(m.dueToday).toBe("\u2325\u21e7Q");
        expect(m.dueTomorrow).toBe("\u2325\u21e7W");
        expect(m.dueNextWeek).toBe("\u2325\u21e7E");
        expect(m.dueClear).toBe("\u2325\u21e7X");
        expect(m.openPanel).toBe("\u2325\u21e7D");
        expect(m.toggleDone).toBe("\u2325\u21e7M");
    });
    it("每个命令都有中文 label", () => {
        for (const c of COMMANDS) {
            expect(c.langText.length).toBeGreaterThan(0);
        }
    });
});

describe("currentTaskBlockId 的容错", () => {
    it("没有活动块 → null", async () => {
        active = null;
        expect(await currentTaskBlockId(deps)).toBeNull();
    });
});

describe("T21-T23 完成时触发重复生成钩子", () => {
    it("从未完成 → 完成：触发 onCompleted", async () => {
        const done: string[] = [];
        deps.onCompleted = async (id: string) => { done.push(id); };
        kramdown["TASK"] = "- [ ] 标题";
        await toggleDone(deps);
        expect(done).toEqual(["TASK"]);
        delete deps.onCompleted;
    });
    it("从完成 → 未完成：不触发", async () => {
        const done: string[] = [];
        deps.onCompleted = async (id: string) => { done.push(id); };
        kramdown["TASK"] = "- [X] 标题";
        await toggleDone(deps);
        expect(done).toEqual([]);
        delete deps.onCompleted;
    });
    it("onCompleted 抛异常不影响完成状态写入", async () => {
        deps.onCompleted = async () => { throw new Error("gen boom"); };
        kramdown["TASK"] = "- [ ] 标题";
        await expect(toggleDone(deps)).resolves.toBeUndefined();
        expect(krWrites).toHaveLength(1);
        expect(krWrites[0].md).toBe("- [X] 标题");
        delete deps.onCompleted;
    });
});
