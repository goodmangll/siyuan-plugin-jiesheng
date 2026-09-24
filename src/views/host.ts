/**
 * 视图层与思源之间的**唯一接口**。
 *
 * 组件不直接碰思源 API —— 全部通过这个 host。理由：
 *   1. React 组件可以脱离思源单独渲染（测试、Storybook）
 *   2. 「怎么取数、写到哪」这类判断留在 host 的实现里，不散在 JSX 里
 */

import type { Priority } from "../model/priority";
import type { SmartListId } from "./query";
import type { ViewTask } from "./model";

/** 视图类型：5 个智能清单 + 4 个专属视图 */
export type ViewId = SmartListId | "board" | "calendar" | "matrix" | "stats";

export const VIEW_TABS: { id: ViewId; label: string; group: "smart" | "view" }[] = [
    { id: "today", label: "今天", group: "smart" },
    { id: "tomorrow", label: "明天", group: "smart" },
    { id: "next7", label: "未来 7 天", group: "smart" },
    { id: "inbox", label: "收件箱", group: "smart" },
    { id: "all", label: "全部", group: "smart" },
    { id: "board", label: "看板", group: "view" },
    { id: "calendar", label: "日历", group: "view" },
    { id: "matrix", label: "四象限", group: "view" },
    { id: "stats", label: "统计", group: "view" },
];

export interface ViewHost {
    /** 今天（yyyyMMdd）。不在组件里取，方便测试注入。 */
    today(): string;
    /** 拉某个视图的任务 */
    load(view: ViewId, today: string): Promise<ViewTask[]>;
    /** 侧边栏计数 */
    counts(today: string): Promise<Record<SmartListId, number>>;
    /** 勾选完成 / 取消完成（内部会处理重复任务生成） */
    toggleDone(id: string): Promise<void>;
    /** 在文档里定位到这个块 */
    openBlock(id: string): void;
    /** 打开右侧详情面板（复用 Dock 面板） */
    openDetail(id: string): void;
    /** 改截止日；null = 清除 */
    setDue(id: string, due: string | null): Promise<void>;
    /** 改优先级 */
    setPriority(id: string, priority: Priority): Promise<void>;
    /** 新建任务 */
    createTask(title: string, due: string | null): Promise<void>;
    /** 外部变动（思源里改了东西）时通知视图刷新；返回取消订阅 */
    subscribe?(onChange: () => void): () => void;
    /** 轻提示 */
    toast?(message: string): void;
}
