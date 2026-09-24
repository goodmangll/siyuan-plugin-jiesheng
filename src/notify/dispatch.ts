/** 把一条事件分发给所有已配置的通道。**单个通道出问题不能影响其它通道。** */

import type { ChannelConfig, DispatchResult, NotifyChannel, RemindEvent } from "./types";

export type { NotifyChannel, NotifyResult, ChannelConfig, DispatchResult, RemindEvent } from "./types";

export async function dispatch(
    channels: NotifyChannel[],
    config: ChannelConfig,
    event: RemindEvent,
): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const ch of channels ?? []) {
        const cfg = config?.[ch.id];
        if (!cfg) {
            // 没配置就跳过 —— 用户只填了他真正想用的通道
            continue;
        }
        try {
            const r = await ch.send(event, cfg);
            results.push({ channelId: ch.id, ok: Boolean(r?.ok), detail: r?.detail });
        } catch (e) {
            results.push({ channelId: ch.id, ok: false, detail: (e as Error)?.message ?? String(e) });
        }
    }
    return results;
}

/** 一条事件分发给所有通道，全成功才算成功 */
export async function dispatchAll(
    channels: NotifyChannel[],
    config: ChannelConfig,
    events: RemindEvent[],
): Promise<DispatchResult[]> {
    const all: DispatchResult[] = [];
    for (const ev of events ?? []) {
        all.push(...await dispatch(channels, config, ev));
    }
    return all;
}
