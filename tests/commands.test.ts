import { beforeEach, describe, expect, it } from "vitest";
import {
    COMMANDS, clearDue, currentTaskBlockId, openPanel, setPriority, setDueTo, toggleDone, togglePin,
    type TaskCommandDeps,
} from "../src/commands";
import { ATTR } from "../src/model/attrs";

const NOW = new Date(2026, 8, 25, 10, 0); // 2026-09-25 周五

let writes: { id: string; patch: Record<string, string> }[] = [];
let doneToggles: string[] = [];
let toasts: string[] = [];
let store: Record<string, Record<string, string>> = {};
let active: string | null = "TASK";

const deps: TaskCommandDeps = {
    now: () => NOW,
    activeTaskBlockId: async () => active,
    readAttrs: async (id) => store[id] ?? {},
    writeAttrs: async (id, patch) => {
        writes.push({ id, patch });
        store[id] = { ...(store[id] ?? {}), ...patch };
    },
    // 完成/取消完成是**注入**的：面板、视图、快捷键必须共用同一份实现。
    // 曾经这里是 readKramdown/writeKramdown 各写一套。
    toggleDone: async (id) => { doneToggles.push(id); },
    openPanel: () => {},
    toast: (m) => toasts.push(m),
};

beforeEach(() => {
    writes = []; doneToggles = []; toasts = []; store = {}; active = "TASK";
    store.TASK = { [ATTR.task]: "1" };
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

describe("T14/T15 完成状态 —— 必须和面板/视图走同一条实现", () => {
    it("★ 完成走注入的 toggleDone（custom-done 那一条），不再自己切 kramdown", async () => {
        // 这里曾经自己实现了一份 kramdown 版本：读文档的 kramdown 首行，
        // 把 `- [ ]` 改成 `- [X]`。模型改成「任务=文档」以后，
        // 文档的 kramdown 压根不是任务列表项，isTaskKramdown 恒为 false，
        // 于是 ⌥⇧M 永远只弹「当前块不是任务」—— 一次都没生效过。
        await toggleDone(deps);
        expect(doneToggles).toEqual(["TASK"]);
        expect(writes).toHaveLength(0); // 不再直接写属性，交给那一份实现
    });
    it("光标不在任何任务上 → 不写，给提示", async () => {
        active = null;
        await toggleDone(deps);
        expect(doneToggles).toHaveLength(0);
        expect(toasts.some((t) => t.includes("光标"))).toBe(true);
    });
    it("当前文档不是任务（没 custom-task）→ 不写，给提示", async () => {
        store.TASK = {};
        await toggleDone(deps);
        expect(doneToggles).toHaveLength(0);
        expect(toasts.some((t) => t.includes("不是任务"))).toBe(true);
    });
    it("custom-task 为 '0' / 空串也算不是任务", async () => {
        store.TASK = { [ATTR.task]: "" };
        await toggleDone(deps);
        expect(doneToggles).toHaveLength(0);
    });
});

describe("命令表与快捷键（方向级验收）", () => {
    it("13 个命令；占热键的必须全部落在 Alt+Shift 空间", () => {
        // 10 个改属性的 + 打开任务视图 Tab（⌥⇧T）+ 置顶（⌥⇧U）+ 打开设置（不占热键）
        expect(COMMANDS).toHaveLength(13);
        for (const c of COMMANDS) {
            for (const hk of c.hotkeys) {
                expect(hk.startsWith("\u2325\u21e7")).toBe(true); // ⌥⇧
            }
        }
    });
    it("只有一个命令不占热键（打开设置：思源插件列表里本来就有齿轮入口）", () => {
        const noKey = COMMANDS.filter((c) => c.hotkeys.length === 0);
        expect(noKey.map((c) => c.langKey)).toEqual(["openSettings"]);
    });
    it("优先级 1/2/3/0", () => {
        const m = Object.fromEntries(COMMANDS.map((c) => [c.langKey, c.hotkeys[0]]));
        expect(m.priorityHigh).toBe("\u2325\u21e71");
        expect(m.priorityMedium).toBe("\u2325\u21e72");
        expect(m.priorityLow).toBe("\u2325\u21e73");
        expect(m.priorityNone).toBe("\u2325\u21e70");
    });
    it("打开视图 Tab 用 ⌥⇧T（T 未被思源占用）", () => {
        const m = Object.fromEntries(COMMANDS.map((c) => [c.langKey, c.hotkeys[0]]));
        expect(m.openTaskTab).toBe("\u2325\u21e7T");
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

describe("T21-T23 完成时触发重复生成 —— 判定已下沉到 actions.toggleTaskDone", () => {
    it("命令层只负责「转交」，不在这一层判定完成前后", async () => {
        // 「刚变成完成才生成、取消完成不生成」的判定在 actions.toggleTaskDone 里，
        // 命令层再判一次就会出现两份真相（这正是 ⌥⇧M 坏掉时的形状）。
        const calls: string[] = [];
        deps.toggleDone = async (id) => { calls.push(id); };
        await toggleDone(deps);
        expect(calls).toEqual(["TASK"]);
    });
    it("转交目标抛异常时，异常向上抛（由命令注册处兜底 toast）", async () => {
        deps.toggleDone = async () => { throw new Error("boom"); };
        await expect(toggleDone(deps)).rejects.toThrow("boom");
    });
});

describe("T8 ⌥⇧D 要请求把焦点给日期区", () => {
    it("打开面板时带上 focus='due'（之前 focus 参数被整个丢掉了）", async () => {
        const seen: (string | undefined)[] = [];
        deps.openPanel = (_id: string, focus?: string) => { seen.push(focus); };
        await openPanel(deps);
        expect(seen).toEqual(["due"]);
    });
});

describe("T13 快捷键改日期也要让提醒同步重算（面板路径早已支持，快捷键路径漏了）", () => {
    it("⌥⇧W：due 9/25 → 9/26，提醒 9/24 09:00 → 9/25 09:00", async () => {
        store.TASK = { [ATTR.due]: "20260925", [ATTR.remind]: "202609240900" };
        await setDueTo(deps, "tomorrow");
        expect(writes).toHaveLength(1);
        expect(writes[0].patch[ATTR.due]).toBe("20260926");
        expect(writes[0].patch[ATTR.remind]).toBe("202609250900");
    });
    it("⌥⇧Q：全天进全天出，提醒按天平移", async () => {
        store.TASK = { [ATTR.due]: "20261001", [ATTR.remind]: "202609300900" };
        await setDueTo(deps, "today");
        expect(writes[0].patch[ATTR.due]).toBe("20260925");
        expect(writes[0].patch[ATTR.remind]).toBe("202609240900");
    });
    it("没有提醒时不多写 remind 键", async () => {
        store.TASK = { [ATTR.due]: "20260925" };
        await setDueTo(deps, "tomorrow");
        expect(writes[0].patch).not.toHaveProperty(ATTR.remind);
    });
    it("⌥⇧X 清除日期：due 与提醒一起清（提醒指向不存在的日期没有意义）", async () => {
        store.TASK = { [ATTR.due]: "20260925", [ATTR.remind]: "202609240900" };
        await clearDue(deps);
        expect(writes[0].patch[ATTR.due]).toBe("");
        expect(writes[0].patch[ATTR.remind]).toBe("");
    });
});

describe("T18 多块选中：只作用于光标那一个，但要明说", () => {
    it("选中 2 个块 → 给出一次提示，且仍然作用于光标块", async () => {
        store.TASK = {};
        deps.selectedBlockCount = () => 2;
        await setPriority(deps, "high");
        expect(writes).toHaveLength(1);
        expect(writes[0].id).toBe("TASK");
        expect(toasts.some((t) => t.includes("多个块"))).toBe(true);
        delete deps.selectedBlockCount;
    });
    it("只选中 1 个 → 不打扰", async () => {
        store.TASK = {};
        deps.selectedBlockCount = () => 1;
        await setPriority(deps, "high");
        expect(toasts.some((t) => t.includes("多个块"))).toBe(false);
        delete deps.selectedBlockCount;
    });
});

describe("T23 置顶：用 custom-pin 属性 + 视图排序，不用 moveBlock", () => {
    it("未置顶 → 置顶", async () => {
        store.TASK = {};
        await togglePin(deps);
        expect(writes[0].patch[ATTR.pin]).toBe("1");
        expect(toasts.some((t) => t.includes("已置顶"))).toBe(true);
    });
    it("已置顶 → 取消（写空串即删除属性）", async () => {
        store.TASK = { [ATTR.pin]: "1" };
        await togglePin(deps);
        expect(writes[0].patch[ATTR.pin]).toBe("");
        expect(toasts.some((t) => t.includes("取消置顶"))).toBe(true);
    });
    it("空串也算未置顶", async () => {
        store.TASK = { [ATTR.pin]: "" };
        await togglePin(deps);
        expect(writes[0].patch[ATTR.pin]).toBe("1");
    });
    it("⌥⇧U 未被思源占用，落在 Alt+Shift 空间", () => {
        const m = Object.fromEntries(COMMANDS.map((c) => [c.langKey, c.hotkeys[0]]));
        expect(m.togglePin).toBe("\u2325\u21e7U");
    });
});
