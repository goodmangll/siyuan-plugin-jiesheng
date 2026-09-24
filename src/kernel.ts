/**
 * 内核插件：提醒守护的**调度骨架**。
 *
 * 只做骨架，不含任何具体推送通道：
 *   扫库 → 算到期事件 → 交给 CHANNELS 分发（当前为空）→ 记日志 → 推进游标
 *
 * 运行在思源内核进程里的 goja 运行时（M0 实测：`setInterval` 可用，`require` 只有 url/util，
 * 读写文件必须走 `siyuan.storage`）。
 */

import { advanceCursor, dueEvents, type TaskRow } from "./notify/scan";
import { dispatch, type ChannelConfig, type NotifyChannel } from "./notify/dispatch";
import { formatRemindMessage, remindPayload } from "./notify/format";

// goja 里的全局对象，没有类型定义，这里声明最小面
declare const siyuan: {
    plugin: {
        name: string;
        platform: string;
        lifecycle: {
            onload?: () => void | Promise<void>;
            onrunning?: () => void | Promise<void>;
            onunload?: () => void | Promise<void>;
        };
    };
    logger: {
        info: (...args: unknown[]) => Promise<void>;
        warn: (...args: unknown[]) => Promise<void>;
        error: (...args: unknown[]) => Promise<void>;
    };
    storage: {
        get(path: string): Promise<{ text(): Promise<string> }>;
        put(path: string, content: string): Promise<void>;
    };
    client: {
        fetch(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }):
            Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
    };
};

const TICK_MS = 60_000;
const STATE_PATH = "remind-state.json";
const EMPTY_CONFIG: ChannelConfig = {};

/**
 * 已注册的推送通道。
 *
 * **当前为空** —— 抽象已就位；接一个通道（企业微信机器人 / Bark / Server酱 / Telegram…）
 * 就是往这个数组里加一个 `NotifyChannel` 实现，再在配置里给它一份 config。
 * 空数组时这个守护**只记日志、不产生任何副作用**，可以安全地跑着。
 */
export const CHANNELS: NotifyChannel[] = [];

interface KernelState {
    /** 已推送到哪个时刻（`yyyyMMddHHmm`） */
    cursor: string;
    /** 累计「本该推送」的事件数，便于观察是否在工作 */
    seen: number;
}

let state: KernelState = { cursor: "", seen: 0 };
let timer: ReturnType<typeof setInterval> | null = null;

const pad = (n: number): string => String(n).padStart(2, "0");

/** 本地时区的 `yyyyMMddHHmm`（与 model/date 的约定一致） */
export function nowStr(d: Date = new Date()): string {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function loadState(): Promise<{ loaded: boolean }> {
    try {
        const obj = await siyuan.storage.get(STATE_PATH);
        const parsed = JSON.parse(await obj.text()) as Partial<KernelState>;
        state = { cursor: String(parsed.cursor ?? ""), seen: Number(parsed.seen ?? 0) };
        return { loaded: true };
    } catch {
        return { loaded: false };
    }
}

async function saveState(): Promise<void> {
    try {
        await siyuan.storage.put(STATE_PATH, JSON.stringify(state));
    } catch (e) {
        await siyuan.logger.warn("[task-flow] 保存游标失败", String(e));
    }
}

/** 查「有提醒且未完成」的任务 */
async function queryTasks(): Promise<TaskRow[]> {
    const stmt = `
select b.id, b.content as title,
       (select value from attributes where block_id=b.id and name='custom-remind') as remind,
       (select value from attributes where block_id=b.id and name='custom-due') as due,
       (select value from attributes where block_id=b.id and name='custom-pri') as pri,
       (select value from attributes where block_id=b.id and name='custom-list') as list
from blocks b
where b.type='i' and b.subtype='t' and b.markdown like '- [ ]%'
  and (select value from attributes where block_id=b.id and name='custom-remind') is not null
  and (select value from attributes where block_id=b.id and name='custom-abandoned') is null
order by b.updated desc
limit 200`.trim();

    const res = await siyuan.client.fetch("/api/query/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stmt }),
    });
    if (!res.ok) {
        await siyuan.logger.warn("[task-flow] SQL 失败", String(res.status));
        return [];
    }
    const body = await res.json() as { code?: number; data?: TaskRow[] };
    return body?.code === 0 ? (body.data ?? []) : [];
}

/**
 * 一次心跳。
 *
 * 首次运行时把游标初始化为**当前时刻**（而不是空串）——
 * 否则历史上所有过期提醒会在启用插件的瞬间一次性炸出来。
 */
export async function tick(): Promise<void> {
    const now = nowStr();
    const events = dueEvents(await queryTasks(), now, state.cursor);

    if (events.length === 0) {
        return;
    }
    state.seen += events.length;

    // 分发（CHANNELS 为空时没有任何副作用，只在这里留证据）
    const results = await dispatch(CHANNELS, EMPTY_CONFIG, events[0]);
    for (const ev of events) {
        await siyuan.logger.info(
            `[task-flow] 提醒到点 ${formatRemindMessage(ev)} payload=${JSON.stringify(remindPayload(ev))}`,
        );
    }
    if (CHANNELS.length > 0) {
        for (const r of results) {
            await siyuan.logger.info(`[task-flow] 通道 ${r.channelId} ok=${r.ok} ${r.detail ?? ""}`);
        }
    } else {
        await siyuan.logger.info("[task-flow] 未注册任何推送通道，仅记录（抽象层已就位）");
    }

    state.cursor = advanceCursor(state.cursor, events);
    await saveState();
}

export async function start(): Promise<void> {
    const { loaded } = await loadState();
    if (!loaded) {
        state.cursor = nowStr();
        await saveState();
        await siyuan.logger.info(`[task-flow] 首次运行，游标初始化为 ${state.cursor}（不补推历史提醒）`);
    }
    await siyuan.logger.info(`[task-flow] 提醒守护启动 cursor=${state.cursor} 通道数=${CHANNELS.length}`);

    if (typeof setInterval !== "function") {
        await siyuan.logger.warn("[task-flow] 当前运行时没有 setInterval，心跳未启动");
        return;
    }
    timer = setInterval(() => {
        void tick().catch(async (e) => {
            await siyuan.logger.error("[task-flow] tick 失败", String(e));
        });
    }, TICK_MS);
}

export function stop(): void {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
}

siyuan.plugin.lifecycle.onload = () => { void start(); };
siyuan.plugin.lifecycle.onunload = () => { stop(); };
