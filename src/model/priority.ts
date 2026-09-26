/**
 * 优先级：只存 1 / 2 / 3，空 = 无。
 *
 * 用 1/2/3 而不是 5/3/1/0：既要能在块属性面板里手打、又要在 SQL 里直接 order by，
 * 「越小越高」的直觉最省事。
 */

export const PRIORITY = {
    high: "high",
    medium: "medium",
    low: "low",
    none: "none",
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

const ATTR_BY_PRIORITY: Record<Priority, string | null> = {
    high: "1",
    medium: "2",
    low: "3",
    none: null,
};

const PRIORITY_BY_ATTR: Record<string, Priority> = {
    "1": "high",
    "2": "medium",
    "3": "low",
};

/** 属性值 → 优先级档位；任何非法/空值都归为 none */
export function parsePriority(attr: string | null | undefined): Priority {
    if (typeof attr !== "string") {
        return "none";
    }
    return PRIORITY_BY_ATTR[attr.trim()] ?? "none";
}

/** 优先级档位 → 属性值；none 返回 null，调用方据此删除属性 */
export function priorityAttr(p: Priority): string | null {
    return ATTR_BY_PRIORITY[p] ?? null;
}

/** 排序键：高 0 < 中 1 < 低 2 < 无 3 */
export function prioritySortKey(p: Priority): number {
    switch (p) {
        case "high":
            return 0;
        case "medium":
            return 1;
        case "low":
            return 2;
        default:
            return 3;
    }
}

/** 展示用中文名 */
export function priorityLabel(p: Priority): string {
    switch (p) {
        case "high":
            return "高";
        case "medium":
            return "中";
        case "low":
            return "低";
        default:
            return "无";
    }
}
