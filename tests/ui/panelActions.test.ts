import { describe, expect, it } from "vitest";
import { ATTR } from "../../src/model/attrs";
import {
    REMIND_PRESETS, patchAbandon, patchDue, patchList, patchPriority,
    patchRange, patchRemindAdd, patchRemindClear, patchRemindPreset, patchRemindRemove,
    patchRepeatClear, patchRepeatPreset, patchRepeatUntil, shiftReminders,
} from "../../src/ui/panelActions";

const NOW = new Date(2026, 8, 25, 10, 0); // 2026-09-25 周五

describe("U1 日期", () => {
    it("今天：全天进全天出", () => {
        expect(patchDue({ [ATTR.due]: "20260101" }, "today", NOW)).toEqual({ [ATTR.due]: "20260925" });
    });
    it("明天：保留原时刻", () => {
        expect(patchDue({ [ATTR.due]: "202601011430" }, "tomorrow", NOW)).toEqual({ [ATTR.due]: "202609261430" });
    });
    it("后天", () => {
        expect(patchDue({}, "dayAfter", NOW)).toEqual({ [ATTR.due]: "20260927" });
    });
    it("U2 清除写空串", () => {
        expect(patchDue({ [ATTR.due]: "20260925" }, "clear", NOW)).toEqual({ [ATTR.due]: "" });
    });
    it("U15 只含 custom-due，不误伤 start", () => {
        const p = patchDue({ [ATTR.start]: "202609201000" }, "today", NOW);
        expect(Object.keys(p)).toEqual([ATTR.due]);
    });
});

describe("U3 时间段", () => {
    it("同时写 start + due", () => {
        expect(patchRange("202609250900", "202609251200")).toEqual({
            [ATTR.start]: "202609250900",
            [ATTR.due]: "202609251200",
        });
    });
    it("任一为空 → 对应键写空串（= 清除）", () => {
        expect(patchRange("", "202609251200")).toEqual({ [ATTR.start]: "", [ATTR.due]: "202609251200" });
    });
});

describe("U4 优先级", () => {
    it("四档", () => {
        expect(patchPriority("high")).toEqual({ [ATTR.pri]: "1" });
        expect(patchPriority("medium")).toEqual({ [ATTR.pri]: "2" });
        expect(patchPriority("low")).toEqual({ [ATTR.pri]: "3" });
        expect(patchPriority("none")).toEqual({ [ATTR.pri]: "" });
    });
});

describe("U5/U6 提醒预设", () => {
    it("预设清单齐全且都与 due 有关", () => {
        const ids = REMIND_PRESETS.map((p) => p.id);
        expect(ids).toEqual(["at0", "d1", "d2", "d3", "w1", "m5", "ontime"]);
        for (const p of REMIND_PRESETS) {
            expect(p.label.length).toBeGreaterThan(0);
        }
    });
    it("全天 due 20260925 + 提前2天09:00 → 202609230900", () => {
        expect(patchRemindPreset({ [ATTR.due]: "20260925" }, "d2")).toEqual({
            [ATTR.remind]: "202609230900",
        });
    });
    it("准点：有时刻用原时刻", () => {
        expect(patchRemindPreset({ [ATTR.due]: "202609251430" }, "ontime")).toEqual({
            [ATTR.remind]: "202609251430",
        });
    });
    it("没有 due 时预设不写（提示由 UI 层负责）", () => {
        expect(patchRemindPreset({}, "d2")).toBeNull();
    });
    it("U6 自定义绝对时刻", () => {
        expect(patchRemindAdd({}, "202609251200")).toEqual({ [ATTR.remind]: "202609251200" });
    });
});

describe("U7/U8 多条提醒", () => {
    it("累加", () => {
        expect(patchRemindAdd({ [ATTR.remind]: "202609230900" }, "202609240900")).toEqual({
            [ATTR.remind]: "202609230900 202609240900",
        });
    });
    it("去重 + 升序", () => {
        expect(patchRemindAdd({ [ATTR.remind]: "202609240900 202609230900" }, "202609230900")).toEqual({
            [ATTR.remind]: "202609230900 202609240900",
        });
    });
    it("删单条", () => {
        expect(patchRemindRemove({ [ATTR.remind]: "202609230900 202609240900" }, "202609230900")).toEqual({
            [ATTR.remind]: "202609240900",
        });
    });
    it("删最后一条 → 写空串", () => {
        expect(patchRemindRemove({ [ATTR.remind]: "202609230900" }, "202609230900")).toEqual({
            [ATTR.remind]: "",
        });
    });
    it("全清", () => {
        expect(patchRemindClear()).toEqual({ [ATTR.remind]: "" });
    });
});

describe("U9 改 due 时提醒按同一 delta 平移", () => {
    it("+6 天：9/23 09:00 → 9/29 09:00", () => {
        expect(shiftReminders(["202609230900"], "20260925", "20261001")).toEqual(["202609290900"]);
    });
    it("跨月跨年都对", () => {
        expect(shiftReminders(["202612310900"], "20261231", "20270101")).toEqual(["202701010900"]);
    });
    it("多条一起平移", () => {
        expect(shiftReminders(["202609230900", "202609240900"], "20260925", "20260926"))
            .toEqual(["202609240900", "202609250900"]);
    });
    it("原 due 为空 → 不平移，原样返回", () => {
        expect(shiftReminders(["202609230900"], "", "20260926")).toEqual(["202609230900"]);
    });
    it("patchDue 会带上平移后的提醒（只在这一种情况下才动 remind）", () => {
        const attrs = { [ATTR.due]: "20260925", [ATTR.remind]: "202609230900" };
        const p = patchDue(attrs, "today", new Date(2026, 9, 1, 10, 0));
        expect(p[ATTR.due]).toBe("20261001");
        expect(p[ATTR.remind]).toBe("202609290900");
    });
    it("没有提醒时不该多写一个 remind 键", () => {
        const p = patchDue({ [ATTR.due]: "20260925" }, "today", NOW);
        expect(p).not.toHaveProperty(ATTR.remind);
    });
});

describe("U10/U11/U12 重复", () => {
    it("anchor 取当前 due", () => {
        expect(patchRepeatPreset({ [ATTR.due]: "20260930" }, "monthly", NOW)).toEqual({
            [ATTR.repeat]: "FREQ=MONTHLY;BYMONTHDAY=30",
        });
    });
    it("没有 due 时 anchor 取今天", () => {
        expect(patchRepeatPreset({}, "monthly", NOW)).toEqual({
            [ATTR.repeat]: "FREQ=MONTHLY;BYMONTHDAY=25",
        });
    });
    it("U11 结束条件：按日期 / 按次数 / 一直", () => {
        expect(patchRepeatUntil({ [ATTR.repeat]: "FREQ=DAILY" }, "20261231")).toEqual({
            [ATTR.repeat]: "FREQ=DAILY;UNTIL=20261231",
        });
        expect(patchRepeatUntil({ [ATTR.repeat]: "FREQ=DAILY" }, null)).toEqual({
            [ATTR.repeat]: "FREQ=DAILY",
        });
        expect(patchRepeatUntil({}, "20261231")).toBeNull();
    });
    it("U12 清除", () => {
        expect(patchRepeatClear()).toEqual({ [ATTR.repeat]: "" });
    });
});

describe("U13/U14 清单与放弃", () => {
    it("清单设置 / 清除", () => {
        expect(patchList("工作")).toEqual({ [ATTR.list]: "工作" });
        expect(patchList(null)).toEqual({ [ATTR.list]: "" });
        expect(patchList("   ")).toEqual({ [ATTR.list]: "" });
    });
    it("放弃设置 / 取消", () => {
        expect(patchAbandon(true)).toEqual({ [ATTR.abandoned]: "1" });
        expect(patchAbandon(false)).toEqual({ [ATTR.abandoned]: "" });
    });
});

describe("U16 空属性不抛异常", () => {
    it("所有面板动作在 attrs={} 上都能跑", () => {
        expect(() => patchDue({}, "today", NOW)).not.toThrow();
        expect(() => patchPriority("high")).not.toThrow();
        expect(() => patchRemindPreset({}, "d2")).not.toThrow();
        expect(() => patchRemindAdd({}, "202609251200")).not.toThrow();
        expect(() => patchRemindRemove({}, "202609251200")).not.toThrow();
        expect(() => patchRepeatPreset({}, "daily", NOW)).not.toThrow();
        expect(() => patchRepeatUntil({}, null)).not.toThrow();
        expect(() => patchList(null)).not.toThrow();
        expect(() => shiftReminders([], "", "")).not.toThrow();
    });
});
