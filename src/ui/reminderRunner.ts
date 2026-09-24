/**
 * 前端提醒跑者：**在思源里弹提示 + 桌面通知**。
 *
 * 为什么前端也要扫一遍：**内核不能弹通知**（goja 没有 DOM）。
 * 所以两边各管一段 —— 内核发 webhook（界面关着也能发），前端弹通知（界面开着时）。
 *
 * 两边各有自己的游标，这是**刻意的**：
 * 前端只在界面开着时跑，如果共用内核游标，界面关了三天再打开会被历史提醒刷屏。
 */

import type { RemindEvent } from "../notify/types";
import { advanceCursor, dueEvents } from "../notify/scan";
import { formatRemindMessage } from "../notify/format";

export interface ReminderRow {
    id: string;
    title: string | null;
    remind: string | null;
    due: string | null;
    pri: string | null;
    lst: string | null;
}

export interface ReminderRunnerDeps {
    /** 现在的时刻，`yyyyMMddHHmm` */
    now(): string;
    /** 读游标（前端自己那份） */
    readCursor(): string | null;
    writeCursor(cursor: string): void;
    /** 取提醒候选（共用 views/query.remindCandidatesSql） */
    loadCandidates(): Promise<ReminderRow[]>;
    /** 思源内提示 */
    toast(message: string): void;
    /** 桌面通知（可能没授权 / 不支持） */
    notifyDesktop(title: string, body: string): void;
    /** 本次是否要弹通知（用户可以在设置里关掉） */
    wantsInApp(): boolean;
    wantsDesktop(): boolean;
}

export interface RunnerResult {
    fired: number;
    cursor: string;
}

/**
 * 跑一轮。**返回推了几条 + 新游标**，方便日志与测试。
 *
 * 首次运行（没有游标）把游标设成 now —— 否则界面一打开，
 * 历史提醒会一次性全炸出来。
 */
export async function runReminderScan(deps: ReminderRunnerDeps): Promise<RunnerResult> {
    const now = deps.now();
    const stored = deps.readCursor();
    if (!stored) {
        deps.writeCursor(now);
        return { fired: 0, cursor: now };
    }

    let rows: ReminderRow[];
    try {
        rows = await deps.loadCandidates();
    } catch {
        return { fired: 0, cursor: stored };
    }

    // 直接喂给共用的 dueEvents —— 别再自己写一套解析，那是漂移的起点
    const tasks = rows.map((r) => ({
        id: r.id,
        title: (r.title ?? "").trim(),
        remind: (r.remind ?? "").trim(),
        due: (r.due ?? "").trim(),
        pri: (r.pri ?? "").trim(),
        list: (r.lst ?? "").trim(),
    }));

    const events = dueEvents(tasks, now, stored);
    for (const ev of events) {
        const msg = formatRemindMessage(ev);
        if (deps.wantsInApp()) {
            deps.toast(msg);
        }
        if (deps.wantsDesktop()) {
            deps.notifyDesktop(ev.title || "任务提醒", msg);
        }
    }

    // 游标推进到**实际推过的最大时刻**，不是 now —— 时钟回拨时用 now 会永久漏推
    const cursor = advanceCursor(stored, events);
    if (cursor !== stored) {
        deps.writeCursor(cursor);
    }
    return { fired: events.length, cursor };
}

export type { RemindEvent };
