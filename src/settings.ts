/**
 * 插件设置 —— 存在**前端和内核都能读到**的同一个文件里。
 *
 * 路径：`data/storage/petal/<插件名>/settings.json`
 *   - 内核侧：`siyuan.storage`（goja 里唯一可用的文件 I/O）
 *   - 前端侧：`/api/file/getFile` / `putFile`（真机验证过能读写同一路径）
 *
 * 为什么必须共享：**内核不能弹通知**（goja 没有 DOM），
 * 而**前端只在界面打开时运行**。所以两边各管一段：
 *   前端 = 思源内提示 + 桌面通知     内核 = webhook（界面关着也能发）
 * 而"要不要发、发到哪"必须读同一份配置。
 */

export interface TaskFlowSettings {
    /** 通用 webhook 地址；空 = 不发 */
    webhook?: string;
    /** 在思源里弹提示 */
    inApp?: boolean;
    /** 桌面通知（首次会请求浏览器授权） */
    desktop?: boolean;
}

export const SETTINGS_FILE = "settings.json";

export const DEFAULT_SETTINGS: TaskFlowSettings = {
    webhook: "",
    inApp: true,
    desktop: true,
};

/** 合并成完整设置（缺字段用默认值，非法值一律当默认） */
export function normalizeSettings(raw: unknown): TaskFlowSettings {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const s = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
    const str = (v: unknown, d: string): string => (typeof v === "string" ? v.trim() : d);
    return {
        webhook: str(o.webhook, DEFAULT_SETTINGS.webhook ?? ""),
        inApp: s(o.inApp, DEFAULT_SETTINGS.inApp ?? true),
        desktop: s(o.desktop, DEFAULT_SETTINGS.desktop ?? true),
    };
}

/** 解析设置文件内容；坏 JSON 一律回落默认，不抛 */
export function parseSettings(text: string | null | undefined): TaskFlowSettings {
    if (!text || !text.trim()) {
        return { ...DEFAULT_SETTINGS };
    }
    try {
        return normalizeSettings(JSON.parse(text));
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/** webhook 地址可用吗（只做形态校验，不发探测请求） */
export function isUsableWebhook(url: string | null | undefined): boolean {
    const u = (url ?? "").trim();
    return /^https?:\/\/\S+$/i.test(u);
}
