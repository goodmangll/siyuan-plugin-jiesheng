/**
 * 视图层与思源之间的**唯一接口**。
 *
 * 组件不直接碰思源 API —— 全部通过这个 host。理由：
 *   1. React 组件可以脱离思源单独渲染（测试、Storybook）
 *   2. 「怎么取数、写到哪」这类判断留在 host 的实现里，不散在 JSX 里
 */

import type { Priority } from "../model/priority";
import type { SmartListId } from "./query";
import type { SeriesPoint } from "./stats";
import type { ViewTask } from "./model";

/** 视图类型：5 个智能清单 + 4 个专属视图 */
export type ViewId = SmartListId | "board" | "calendar" | "matrix" | "stats";

export const VIEW_TABS: { id: ViewId; label: string; group: "smart" | "view" }[] = [
    { id: "today", label: "今天", group: "smart" },
    { id: "tomorrow", label: "明天", group: "smart" },
    { id: "next7", label: "未来 7 天", group: "smart" },
    { id: "inbox", label: "收件箱", group: "smart" },
    { id: "all", label: "全部", group: "smart" },
    { id: "done", label: "已完成", group: "smart" },
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
    /** 所有用过的清单名（看板列要用：没任务的清单也得能出现，否则拖不进去） */
    lists(): Promise<string[]>;
    /** 取一个日期区间内的任务（日历用），起含止不含 */
    loadRange(from: string, to: string): Promise<ViewTask[]>;
    /** 近 N 天的新建 / 完成趋势（统计用） */
    trends(today: string, days: number): Promise<{ created: SeriesPoint[]; done: SeriesPoint[] }>;
    /** 未完成任务的分布（统计用） */
    distributions(): Promise<{ byList: { name: string; c: number }[]; byPriority: { p: string; c: number }[] }>;
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
    /** 改清单名；空串 = 移出清单（收件箱） */
    setList(id: string, list: string): Promise<void>;
    /** 新建任务（= 新建文档） */
    createTask(title: string, due: string | null): Promise<void>;
    /* ── 位置即关系：子任务 = 子文档 ── */
    /** 某个任务的直属子任务 */
    childTasks(parentId: string): Promise<{ id: string; title: string }[]>;
    /** 新建子任务（= 在父任务下建子文档） */
    addSubTask(parentId: string, title: string): Promise<void>;
    /** 关联主任务：把任务挂到目标下（任何层级一步到位） */
    linkToParent(taskId: string, parentId: string): Promise<void>;
    /** 解除主任务：挂回笔记本顶层 */
    detach(taskId: string): Promise<void>;
    /** 改文档标题（= 任务改名） */
    renameTask(id: string, title: string): Promise<void>;
    /** 外部变动（思源里改了东西）时通知视图刷新；返回取消订阅 */
    subscribe?(onChange: () => void): () => void;
    /** 轻提示 */
    toast?(message: string): void;
}
