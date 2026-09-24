import { describe, expect, it } from "vitest";
import { ATTR } from "../../src/model/attrs";
import {
    REMIND_PRESETS, patchAbandon, patchDue, patchList, patchPriority,
    patchRange, patchRemindAdd, patchRemindClear, patchRemindPreset, patchRemindRemove,
    patchAllDay, patchRepeatClear, patchRepeatCount, patchRepeatExdateAdd, patchRepeatExdateRemove,
    patchRepeatFrom, patchRepeatPreset, patchRepeatUntil, patchStart, repeatExdates,
    repeatRuleUntil, shiftReminders,
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
        expect(patchRange({}, "202609250900", "202609251200")).toEqual({
            [ATTR.start]: "202609250900",
            [ATTR.due]: "202609251200",
        });
    });
    it("任一为空 → 对应键写空串（= 清除）", () => {
        expect(patchRange({}, "", "202609251200")).toEqual({ [ATTR.start]: "", [ATTR.due]: "202609251200" });
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

// ══════════ 开始时间 / 全天 ══════════

describe("SA 开始时间", () => {
    it("S1 合法 8 位 → 写入", () => {
        expect(patchStart("20260920")).toEqual({ [ATTR.start]: "20260920" });
    });
    it("S2 合法 12 位 → 写入", () => {
        expect(patchStart("202609201000")).toEqual({ [ATTR.start]: "202609201000" });
    });
    it("S3 空 → 清除", () => {
        expect(patchStart("")).toEqual({ [ATTR.start]: "" });
        expect(patchStart(null)).toEqual({ [ATTR.start]: "" });
    });
    it("S4 非法 → null，不写坏数据", () => {
        expect(patchStart("2026-09-20")).toBeNull();
        expect(patchStart("2026092")).toBeNull();
        expect(patchStart("abcdefgh")).toBeNull();
        expect(patchStart("20261345")).toBeNull();
    });
});

describe("AD 全天开关", () => {
    const at = (over = {}) => ({ [ATTR.due]: "202609251430", [ATTR.start]: "202609201000", ...over });

    it("AD1 开全天：12 位 → 8 位（时刻丢掉）", () => {
        expect(patchAllDay(at(), true)[ATTR.due]).toBe("20260925");
    });
    it("AD2 关全天：8 位 → 12 位 09:00", () => {
        expect(patchAllDay({ [ATTR.due]: "20260925" }, false)[ATTR.due]).toBe("202609250900");
    });
    it("AD3 start 同步变形", () => {
        const p = patchAllDay(at(), true);
        expect(p[ATTR.start]).toBe("20260920");
        expect(patchAllDay({ [ATTR.start]: "20260920" }, false)[ATTR.start]).toBe("202609200900");
    });
    it("AD4 提醒**不动** —— 日期没变，只有时刻形态变了", () => {
        const p = patchAllDay(at({ [ATTR.remind]: "202609250900" }), true);
        expect(p).not.toHaveProperty(ATTR.remind);
    });
    it("AD5 没有 due / start 时不炸，也不写多余键", () => {
        expect(patchAllDay({}, true)).toEqual({});
    });
    it("AD6 已经是全天再设全天 → 值不变", () => {
        expect(patchAllDay({ [ATTR.due]: "20260925" }, true)[ATTR.due]).toBe("20260925");
    });
});

// ══════════ 重复：次数 / 排除日期 ══════════

describe("RC 重复次数", () => {
    const daily = { [ATTR.repeat]: "FREQ=DAILY" };
    it("RC1 设次数", () => {
        expect(patchRepeatCount(daily, 3)).toEqual({ [ATTR.repeat]: "FREQ=DAILY;COUNT=3" });
    });
    it("RC2 清除次数但保留其它段", () => {
        expect(patchRepeatCount({ [ATTR.repeat]: "FREQ=WEEKLY;BYDAY=FR;COUNT=5" }, null))
            .toEqual({ [ATTR.repeat]: "FREQ=WEEKLY;BYDAY=FR" });
    });
    it("RC3 非法次数 → null", () => {
        expect(patchRepeatCount(daily, 0)).toBeNull();
        expect(patchRepeatCount(daily, -1)).toBeNull();
        expect(patchRepeatCount(daily, 1.5)).toBeNull();
    });
    it("RC4 没有重复规则 → null（UI 该先让用户选重复）", () => {
        expect(patchRepeatCount({}, 3)).toBeNull();
    });
    it("RC5 非法规则 → null，不抛", () => {
        expect(patchRepeatCount({ [ATTR.repeat]: "FREQ=LUNAR" }, 3)).toBeNull();
    });
});

describe("EX 排除日期", () => {
    const daily = { [ATTR.repeat]: "FREQ=DAILY" };
    it("EX1 加一个", () => {
        expect(patchRepeatExdateAdd(daily, "20260926")).toEqual({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260926" });
    });
    it("EX2 加第二个 → 追加且有序", () => {
        const p = patchRepeatExdateAdd({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260928" }, "20260926");
        expect(p![ATTR.repeat]).toBe("FREQ=DAILY;EXDATE=20260926,20260928");
    });
    it("EX3 加已有的 → 不重复", () => {
        const p = patchRepeatExdateAdd({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260926" }, "20260926");
        expect(p![ATTR.repeat]).toBe("FREQ=DAILY;EXDATE=20260926");
    });
    it("EX4 删一个", () => {
        const p = patchRepeatExdateRemove({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260926,20260928" }, "20260926");
        expect(p![ATTR.repeat]).toBe("FREQ=DAILY;EXDATE=20260928");
    });
    it("EX5 删最后一个 → EXDATE 段整体消失", () => {
        const p = patchRepeatExdateRemove({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260926" }, "20260926");
        expect(p![ATTR.repeat]).toBe("FREQ=DAILY");
    });
    it("EX6 非法日期 → null", () => {
        expect(patchRepeatExdateAdd(daily, "2026-09-26")).toBeNull();
        expect(patchRepeatExdateAdd(daily, "2026092")).toBeNull();
    });
    it("EX7 读取：没有规则 / 没有排除日期都返回空数组", () => {
        expect(repeatExdates(daily)).toEqual([]);
        expect(repeatExdates({})).toEqual([]);
        expect(repeatExdates({ [ATTR.repeat]: "FREQ=DAILY;EXDATE=20260926,20260928" }))
            .toEqual(["20260926", "20260928"]);
    });
});

describe("RF 递推基准", () => {
    it("RF1 设为完成日", () => {
        expect(patchRepeatFrom("done")).toEqual({ [ATTR.repeatFrom]: "done" });
    });
    it("RF2 设为截止日（默认）→ 写空串即移除该属性", () => {
        expect(patchRepeatFrom("due")).toEqual({ [ATTR.repeatFrom]: "" });
    });
    it("RF3 非法值一律按默认（due）处理", () => {
        expect(patchRepeatFrom("banana")).toEqual({ [ATTR.repeatFrom]: "" });
    });
});

describe("RU 读取 UNTIL", () => {
    it("有 UNTIL 时读出", () => {
        expect(repeatRuleUntil({ [ATTR.repeat]: "FREQ=DAILY;UNTIL=20261231" })).toBe("20261231");
    });
    it("没有规则 / 没有 UNTIL → undefined", () => {
        expect(repeatRuleUntil({})).toBeUndefined();
        expect(repeatRuleUntil({ [ATTR.repeat]: "FREQ=DAILY" })).toBeUndefined();
    });
});

describe("PR 直接编辑开始/截止（T13：改日期必须让提醒跟着走）", () => {
    const withRemind = {
        [ATTR.due]: "202609251430",
        [ATTR.remind]: "202609240900",
    };
    it("PR1 截止日期变了 → 提醒按同 delta 平移", () => {
        const p = patchRange(withRemind, "", "20260927");
        expect(p[ATTR.due]).toBe("20260927");
        // 9/25 → 9/27 是 +2 天
        expect(p[ATTR.remind]).toBe("202609260900");
    });
    it("PR2 只改开始时间、截止不变 → 提醒不动", () => {
        const p = patchRange(withRemind, "202609201000", "202609251430");
        expect(p[ATTR.start]).toBe("202609201000");
        expect(p).not.toHaveProperty(ATTR.remind);
    });
    it("PR3 清除截止 → 提醒也清掉（否则会指向一个不存在的日期）", () => {
        const p = patchRange(withRemind, "", "");
        expect(p[ATTR.due]).toBe("");
        expect(p[ATTR.remind]).toBe("");
    });
    it("PR4 没有提醒时不多写键", () => {
        const p = patchRange({ [ATTR.due]: "20260925" }, "", "20260927");
        expect(p).not.toHaveProperty(ATTR.remind);
    });
    it("PR5 原来没有 due（首次设）→ 提醒不动，不误平移", () => {
        const p = patchRange({ [ATTR.remind]: "202609240900" }, "", "20260927");
        expect(p).not.toHaveProperty(ATTR.remind);
    });
    it("PR6 开始时间也带时刻时原样写入", () => {
        expect(patchRange({}, "202609201000", "")[ATTR.start]).toBe("202609201000");
    });
});
