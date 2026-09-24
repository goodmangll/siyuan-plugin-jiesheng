/** 事件 → 人类可读的一行。toast 与 webhook 都用它，保证两边措辞一致。 */

import { priorityLabel } from "../model/priority";
import type { RemindEvent } from "./types";

const MAX_TITLE = 60;

export function formatRemindMessage(event: RemindEvent): string {
    const at = `${event.remindAt.slice(4, 6)}-${event.remindAt.slice(6, 8)} `
        + `${event.remindAt.slice(8, 10)}:${event.remindAt.slice(10, 12)}`;
    const raw = (event.title ?? "").trim().replace(/\s+/g, " ");
    const title = raw.length > MAX_TITLE ? raw.slice(0, MAX_TITLE) + "…" : raw;
    const pri = event.pri && event.pri !== "none" ? `　[优先级 ${priorityLabel(event.pri)}]` : "";
    const list = event.list ? `　@${event.list}` : "";
    return `⏰ ${at}　${title}${pri}${list}`;
}

/** 给 webhook 用的结构化负载（企业微信/Bark/Server酱 都是「POST 一个 JSON」） */
export function remindPayload(event: RemindEvent): Record<string, unknown> {
    return {
        blockId: event.blockId,
        title: event.title,
        remindAt: event.remindAt,
        due: event.due ?? null,
        priority: event.pri ?? "none",
        list: event.list ?? null,
        text: formatRemindMessage(event),
    };
}
