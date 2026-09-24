import { describe, expect, it } from "vitest";
import {
    formatOffsets, fromICalTrigger, offsetToAbsolute, parseOffsets, shiftReminders, toICalTrigger,
} from "../../src/model/remind";

describe("M1 偏移 → 绝对时刻", () => {
    it("全天 due + 提前2天09:00", () => {
        expect(offsetToAbsolute("20260925", "-2d09:00")).toBe("202609230900");
    });
    it("全天 due + 当天09:00", () => {
        expect(offsetToAbsolute("20260925", "0")).toBe("202609250900");
    });
    it("有时刻 due + 当天09:00 会改时刻", () => {
        expect(offsetToAbsolute("202609251430", "0d09:00")).toBe("202609250900");
    });
    it("提前 1 周", () => {
        expect(offsetToAbsolute("20260925", "-1w09:00")).toBe("202609180900");
    });
    it("提前 7 天与提前 1 周等价", () => {
        expect(offsetToAbsolute("20260925", "-7d09:00")).toBe(offsetToAbsolute("20260925", "-1w09:00"));
    });
});

describe("M2 偏移解析", () => {
    it("准点：有时刻就用原时刻", () => {
        expect(offsetToAbsolute("202609251430", "0")).toBe("202609251430");
    });
    it("提前 15 分钟", () => {
        expect(offsetToAbsolute("202609251430", "-15m")).toBe("202609251415");
    });
    it("提前 2 小时（跨日回溯）", () => {
        expect(offsetToAbsolute("202609250100", "-2h")).toBe("202609242300");
    });
    it("提前 1 天（保留原时刻）", () => {
        expect(offsetToAbsolute("202609251430", "-1d")).toBe("202609241430");
    });
    it("非法偏移 → null", () => {
        expect(offsetToAbsolute("20260925", "abc")).toBeNull();
        expect(offsetToAbsolute("20260925", "-2x")).toBeNull();
        expect(offsetToAbsolute("bad", "-2d")).toBeNull();
    });
});

describe("M4 序列化", () => {
    it("空格分隔往返", () => {
        const s = formatOffsets(["202609230900", "202609240900"]);
        expect(s).toBe("202609230900 202609240900");
        expect(parseOffsets(s)).toEqual(["202609230900", "202609240900"]);
    });
    it("空值 / 空白 / 换行都能容错", () => {
        expect(parseOffsets("")).toEqual([]);
        expect(parseOffsets(null)).toEqual([]);
        expect(parseOffsets("  202609230900 \n 202609240900 ")).toEqual(["202609230900", "202609240900"]);
    });
    it("非法项被丢弃", () => {
        expect(parseOffsets("202609230900 xx 202609240900")).toEqual(["202609230900", "202609240900"]);
    });
});

describe("M5 与同类产品 iCal TRIGGER 互转", () => {
    it("-2d09:00 ⇄ -P1DT15H0M0S（相对 due 当天 00:00 的负偏移）", () => {
        expect(toICalTrigger("-2d09:00")).toBe("-P1DT15H");
        expect(fromICalTrigger("-P1DT15H")).toBe("-2d09:00");
        expect(fromICalTrigger("-P1DT15H0M0S")).toBe("-2d09:00"); // 同类产品那种带零写法也认
    });
    it("周偏移在序列化时被规范化为天（语义等价）", () => {
        expect(toICalTrigger("-1w09:00")).toBe("-P6DT15H");
        expect(fromICalTrigger("-P6DT15H")).toBe("-7d09:00");
    });
    it("-5m ⇄ -PT5M", () => {
        expect(toICalTrigger("-5m")).toBe("-PT5M");
        expect(fromICalTrigger("-PT5M")).toBe("-5m");
    });
    // 注意：同类产品自己会输出 `P0DT9H0M0S`（带 0D），本插件输出规范最简形式 `PT9H0M0S`。
    // 两者是同一个时长，互相都能解析，只是字面不同 —— 这里不假装逐字对齐。
    it("当天 09:00 ⇄ PT9H0M0S（规范最简形式）", () => {
        expect(toICalTrigger("0d09:00")).toBe("PT9H");
        expect(fromICalTrigger("PT9H")).toBe("0d09:00");
        expect(fromICalTrigger("P0DT9H0M0S")).toBe("0d09:00"); // 同类产品的形式也认
    });
    it("准点 ⇄ -PT0S", () => {
        expect(toICalTrigger("0")).toBe("-PT0S");
        expect(fromICalTrigger("-PT0S")).toBe("0");
    });
    it("不认识的 TRIGGER → null", () => {
        expect(fromICalTrigger("")).toBeNull();
        expect(fromICalTrigger("nonsense")).toBeNull();
    });
});

describe("M3 改 due 后重算", () => {
    it("同一个偏移，due 变了结果就变", () => {
        expect(offsetToAbsolute("20260925", "-2d09:00")).toBe("202609230900");
        expect(offsetToAbsolute("20261001", "-2d09:00")).toBe("202609290900");
    });
});

describe("SR 提醒平移的两种语义（从现有值反推原始偏移）", () => {
    // 起因：PR1 实测发现「全天 ⇄ 有时刻」混用时，纯按分钟平移会把提醒挪错一天
    it("SR1 日级偏移（提前1天09:00）+ 全天→全天：按天平移，钟点不动", () => {
        // due 9/25，提醒 9/24 09:00；改 due 到 9/27 → 提醒 9/26 09:00
        expect(shiftReminders(["202609240900"], "20260925", "20260927")).toEqual(["202609260900"]);
    });
    it("SR2 日级偏移 + 有时刻 due 改成全天：仍按天平移（这是修掉的 bug）", () => {
        // due 9/25 14:30，提醒 9/24 09:00；改 due 到 9/27（全天）
        // 纯按分钟会得到 9/25 18:30（错），按天应得 9/26 09:00
        expect(shiftReminders(["202609240900"], "202609251430", "20260927")).toEqual(["202609260900"]);
    });
    it("SR3 日级偏移 + 全天改成有时刻：同样按天", () => {
        expect(shiftReminders(["202609240900"], "20260925", "202609271800")).toEqual(["202609260900"]);
    });
    it("SR4 分钟级偏移（提前5分钟）+ 同一天改时刻：按分钟平移", () => {
        // due 9/25 14:30，提醒 14:25；改 due 到 18:00 → 17:55
        expect(shiftReminders(["202609251425"], "202609251430", "202609251800")).toEqual(["202609251755"]);
    });
    it("SR5 日级偏移 + 同一天只改时刻：提醒不动（偏移是按天的）", () => {
        // due 9/25 14:30 → 18:00，提醒仍是 9/24 09:00
        expect(shiftReminders(["202609240900"], "202609251430", "202609251800")).toEqual(["202609240900"]);
    });
    it("SR6 分钟级偏移 + 跨天改期：跟着走", () => {
        // due 9/25 14:30，提醒 14:25；改 due 到 9/27 14:30 → 9/27 14:25
        expect(shiftReminders(["202609251425"], "202609251430", "202609271430")).toEqual(["202609271425"]);
    });
    it("SR7 多条混着日级和分钟级，各按各的语义", () => {
        const got = shiftReminders(["202609240900", "202609251425"], "202609251430", "202609271800");
        expect(got).toEqual(["202609260900", "202609271755"]);
    });
});
