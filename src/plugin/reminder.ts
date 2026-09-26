/**
 * 前端的提醒扫描守护。
 *
 * 为什么在前端也有一份：内核那份（`kernel.ts`）只能发 webhook，
 * 因为它跑在 goja 里、**没有 DOM**，弹不了思源的提示条也弹不了桌面通知。
 * 两份各有自己的游标是刻意的 —— 界面关着时前端不跑，
 * 共用内核游标会导致「关了三天再打开被历史提醒刷屏」。
 */

import { runReminderScan } from "../ui/reminderRunner";
import { remindCandidatesSql } from "../views/query";
import { runSql } from "../api/blocks";
import { toDateTimeStr } from "../model/date";

const CURSOR_KEY = "jiesheng-remind-cursor";
const INTERVAL_MS = 60_000;

export interface ReminderDaemonDeps {
    /** 设置里的两个开关 */
    wantsInApp(): boolean;
    wantsDesktop(): boolean;
    /** 弹思源内的提示条 */
    toast(message: string): void;
    /** 桌面通知（未授权时由实现自己静默丢弃） */
    notifyDesktop(title: string, body: string): void;
    /** 出错时记一笔（默认 console） */
    log?(message: string): void;
    intervalMs?: number;
}

export interface ReminderDaemon {
    start(): void;
    stop(): void;
    /** 立刻跑一次（测试与「刚打开界面」用） */
    tickNow(): Promise<void>;
}

export function createReminderDaemon(deps: ReminderDaemonDeps): ReminderDaemon {
    const log = deps.log ?? ((m: string) => console.log(m));
    let timer: number | null = null;

    const tick = async (): Promise<void> => {
        try {
            const r = await runReminderScan({
                now: () => toDateTimeStr(new Date()),
                readCursor: () => window.localStorage.getItem(CURSOR_KEY),
                writeCursor: (c) => window.localStorage.setItem(CURSOR_KEY, c),
                loadCandidates: async () => {
                    const rows = await runSql<{
                        id: string; title: string | null; remind: string | null;
                        due: string | null; pri: string | null; lst: string | null;
                    }>(remindCandidatesSql());
                    return rows.map((x) => ({
                        id: x.id, title: x.title, remind: x.remind,
                        due: x.due, pri: x.pri, lst: x.lst,
                    }));
                },
                toast: deps.toast,
                notifyDesktop: deps.notifyDesktop,
                wantsInApp: deps.wantsInApp,
                wantsDesktop: deps.wantsDesktop,
            });
            if (r.fired > 0) {
                log(`[结绳] 前端推了 ${r.fired} 条提醒，游标=${r.cursor}`);
            }
        } catch (e) {
            log("[结绳] 提醒扫描出错: " + String((e as Error)?.message ?? e));
        }
    };

    return {
        start() {
            if (timer !== null) {
                return;
            }
            void tick();
            timer = window.setInterval(() => { void tick(); }, deps.intervalMs ?? INTERVAL_MS);
        },
        stop() {
            if (timer !== null) {
                window.clearInterval(timer);
                timer = null;
            }
        },
        tickNow: tick,
    };
}

/**
 * 桌面通知。
 *
 * 权限要在**用户手势**里请求，这里只在已授权时发 —— 否则浏览器会静默丢弃，
 * 表现为「设置开了但没通知」，很难查。
 */
export function notifyDesktop(title: string, body: string): void {
    try {
        const N = (window as unknown as { Notification?: typeof Notification }).Notification;
        if (!N || N.permission !== "granted") {
            return;
        }
        new N(title, { body, tag: "jiesheng-" + body.slice(0, 24) });
    } catch {
        /* 通知失败不影响其它通道 */
    }
}
