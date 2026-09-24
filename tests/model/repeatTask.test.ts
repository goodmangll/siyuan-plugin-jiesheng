import { describe, expect, it } from "vitest";
import { nextRepeatTask, type RepeatTaskMeta } from "../../src/model/repeatTask";
import { parseRule } from "../../src/model/repeat";

const DONE = new Date(2026, 8, 25, 18, 0); // 2026-09-25 18:00 周五

const meta = (over: Partial<RepeatTaskMeta> = {}): RepeatTaskMeta => ({
    due: "20260925",
    remind: [],
    repeat: parseRule("FREQ=DAILY"),
    pri: "none",
    ...over,
});

describe("W1 从截止日递推", () => {
    it("每天：9/25 → 9/26", () => {
        expect(nextRepeatTask(meta(), DONE)?.due).toBe("20260926");
    });
    it("每周五：9/25 → 10/2", () => {
        const r = nextRepeatTask(meta({ repeat: parseRule("FREQ=WEEKLY;BYDAY=FR") }), DONE);
        expect(r?.due).toBe("20261002");
    });
    it("保留原形态：有时刻的 due 仍带时刻", () => {
        const r = nextRepeatTask(meta({ due: "202609251430" }), DONE);
        expect(r?.due).toBe("202609261430");
    });
});

describe("W2 隔周不漂移", () => {
    it("第一次：9/25 → 10/9", () => {
        const rule = parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR")!;
        expect(nextRepeatTask(meta({ repeat: rule }), DONE)?.due).toBe("20261009");
    });
    it("第二次：以 10/9 为 due 再推 → 10/23（相位不漂）", () => {
        const rule = parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR")!;
        const first = nextRepeatTask(meta({ repeat: rule }), DONE)!;
        const second = nextRepeatTask(meta({ due: first.due, repeat: rule }), DONE)!;
        expect(second.due).toBe("20261023");
    });
});

describe("W3 repeatFrom=done", () => {
    it("从完成日推：完成于 9/30(周三)，每周五 → 10/2", () => {
        const r = nextRepeatTask(meta({
            repeat: parseRule("FREQ=WEEKLY;BYDAY=FR"),
            repeatFrom: "done",
        }), new Date(2026, 8, 30, 18, 0));
        expect(r?.due).toBe("20261002");
    });
    it("默认（或写 due）走截止日", () => {
        const a = nextRepeatTask(meta({ repeat: parseRule("FREQ=WEEKLY;BYDAY=FR"), repeatFrom: "due" }), new Date(2026, 8, 30, 18, 0));
        expect(a?.due).toBe("20261002"); // 9/25 的下一个周五恰好也是 10/2
        const b = nextRepeatTask(meta({ repeat: parseRule("FREQ=DAILY") }), new Date(2026, 8, 30, 18, 0));
        expect(b?.due).toBe("20260926"); // 从 due 而非 done
    });
});

describe("W4/W5/W6 结束条件", () => {
    it("UNTIL 已过 → null", () => {
        const r = nextRepeatTask(meta({ due: "20261001", repeat: parseRule("FREQ=DAILY;UNTIL=20261001") }), DONE);
        expect(r).toBeNull();
    });
    it("UNTIL 未到 → 正常生成", () => {
        const r = nextRepeatTask(meta({ repeat: parseRule("FREQ=DAILY;UNTIL=20260930") }), DONE);
        expect(r?.due).toBe("20260926");
    });
    it("W12 COUNT 递减", () => {
        const r = nextRepeatTask(meta({ repeat: parseRule("FREQ=DAILY;COUNT=3") }), DONE);
        expect(r?.repeat).toBe("FREQ=DAILY;COUNT=2");
    });
    it("COUNT=0 → 不再生成", () => {
        expect(nextRepeatTask(meta({ repeat: parseRule("FREQ=DAILY;COUNT=0") }), DONE)).toBeNull();
    });
    it("W6 EXDATE 命中的日期跳过", () => {
        const r = nextRepeatTask(meta({ repeat: parseRule("FREQ=DAILY;EXDATE=20260926") }), DONE);
        expect(r?.due).toBe("20260927");
    });
});

describe("W7/W8 提醒与开始时间同 delta 平移", () => {
    it("提醒跟着 due 走（+1 天）", () => {
        const r = nextRepeatTask(meta({ remind: ["202609230900"] }), DONE);
        expect(r?.remind).toEqual(["202609240900"]);
    });
    it("start 跟着 due 走", () => {
        const r = nextRepeatTask(meta({ start: "202609201000" }), DONE);
        expect(r?.start).toBe("202609211000");
    });
    it("没有 due 时提醒无法平移 → 原样保留（已知限制）", () => {
        const r = nextRepeatTask(meta({ due: undefined, remind: ["202609230900"] }), DONE);
        expect(r?.remind).toEqual(["202609230900"]);
    });
});

describe("W9/W10 非重复任务", () => {
    it("没有 repeat → null", () => {
        expect(nextRepeatTask(meta({ repeat: null }), DONE)).toBeNull();
    });
    it("非法 repeat → null，不抛", () => {
        expect(() => nextRepeatTask(meta({ repeat: null }), DONE)).not.toThrow();
    });
});

describe("W11 没有 due", () => {
    it("以完成日为基准，并给出算出的 due", () => {
        const r = nextRepeatTask(meta({ due: undefined, repeat: parseRule("FREQ=DAILY") }), DONE);
        expect(r?.due).toBe("20260926");
    });
});

describe("W13 结果里不该出现完成态", () => {
    it("返回的字段只有 next 的状态，没有 done/abandoned/spent", () => {
        const r = nextRepeatTask(meta(), DONE)!;
        expect(r).not.toHaveProperty("done");
        expect(r).not.toHaveProperty("abandoned");
        expect(r).not.toHaveProperty("spent");
    });
});
