import { describe, expect, it } from "vitest";
import {
    PRESETS, formatRule, fromPreset, nextOccurrence, parseRule,
} from "../../src/model/repeat";

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("R1 预设 → RRULE", () => {
    it("每天", () => expect(fromPreset("daily", D(2026, 9, 25))).toBe("FREQ=DAILY"));
    it("每周(周五)", () =>
        expect(fromPreset("weekly", D(2026, 9, 25))).toBe("FREQ=WEEKLY;BYDAY=FR"));
    it("每月(25日)", () =>
        expect(fromPreset("monthly", D(2026, 9, 25))).toBe("FREQ=MONTHLY;BYMONTHDAY=25"));
    it("每年(9月25日)", () =>
        expect(fromPreset("yearly", D(2026, 9, 25))).toBe("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=25"));
    it("工作日", () =>
        expect(fromPreset("workday", D(2026, 9, 25))).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"));
    it("周末", () =>
        expect(fromPreset("weekend", D(2026, 9, 25))).toBe("FREQ=WEEKLY;BYDAY=SA,SU"));
    it("隔周", () =>
        expect(fromPreset("biweekly", D(2026, 9, 25))).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"));
    it("每月最后一天", () =>
        expect(fromPreset("monthEnd", D(2026, 9, 25))).toBe("FREQ=MONTHLY;BYMONTHDAY=-1"));
    it("预设清单是 8 个", () => expect(PRESETS).toHaveLength(8));
});

describe("R2 下一个日期", () => {
    const at = (rule: string, from: Date, anchor: Date) => {
        const r = parseRule(rule);
        expect(r).not.toBeNull();
        const d = nextOccurrence(r!, from, anchor);
        return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null;
    };
    it("每天：from+1", () => expect(at("FREQ=DAILY", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-9-26"));
    it("每周五：从周四推到下一个周五", () =>
        expect(at("FREQ=WEEKLY;BYDAY=FR", D(2026, 9, 24), D(2026, 9, 25))).toBe("2026-9-25"));
    it("每周五：从周五推到下周五", () =>
        expect(at("FREQ=WEEKLY;BYDAY=FR", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-10-2"));
    it("每月 25 日：跨月", () =>
        expect(at("FREQ=MONTHLY;BYMONTHDAY=25", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-10-25"));
    it("每年 9/25：跨年", () =>
        expect(at("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=25", D(2026, 9, 25), D(2026, 9, 25))).toBe("2027-9-25"));
    it("工作日：周五 → 下周一", () =>
        expect(at("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-9-28"));
    it("隔周：10/9 而不是 10/2", () =>
        expect(at("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-10-9"));
    it("每月最后一天：9/30", () =>
        expect(at("FREQ=MONTHLY;BYMONTHDAY=-1", D(2026, 9, 25), D(2026, 9, 25))).toBe("2026-9-30"));
    it("每月最后一天：2 月闰年边界", () =>
        expect(at("FREQ=MONTHLY;BYMONTHDAY=-1", D(2028, 2, 1), D(2028, 1, 31))).toBe("2028-2-29"));
});

describe("R3 结束条件", () => {
    it("until 之后不再产生", () => {
        const r = parseRule("FREQ=DAILY;UNTIL=20261001")!;
        expect(nextOccurrence(r, D(2026, 10, 1), D(2026, 9, 25))).toBeNull();
        expect(nextOccurrence(r, D(2026, 9, 30), D(2026, 9, 25))).not.toBeNull();
    });
    it("count 用尽后不再产生", () => {
        const r = parseRule("FREQ=DAILY;COUNT=0")!;
        expect(nextOccurrence(r, D(2026, 9, 25), D(2026, 9, 25))).toBeNull();
        const r2 = parseRule("FREQ=DAILY;COUNT=3")!;
        expect(nextOccurrence(r2, D(2026, 9, 25), D(2026, 9, 25))).not.toBeNull();
    });
});

describe("R4 排除日期", () => {
    it("exdate 命中的日期跳过", () => {
        const r = parseRule("FREQ=DAILY;EXDATE=20260926")!;
        const d = nextOccurrence(r, D(2026, 9, 25), D(2026, 9, 25))!;
        expect(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`).toBe("2026-9-27");
    });
});

describe("R5 非法输入", () => {
    it("空串 / 无 FREQ / 不认识的 FREQ → null，不抛异常", () => {
        expect(parseRule("")).toBeNull();
        expect(parseRule("BYDAY=FR")).toBeNull();
        expect(parseRule("FREQ=HOURLY")).toBeNull();
        expect(parseRule("FREQ=LUNAR")).toBeNull();
        expect(parseRule(undefined as unknown as string)).toBeNull();
    });
});

describe("往返一致", () => {
    it("每个预设都能 format → parse 回来", () => {
        for (const p of PRESETS) {
            const s = fromPreset(p.id, D(2026, 9, 25));
            expect(formatRule(parseRule(s)!)).toBe(s);
        }
    });
});
