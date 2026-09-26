/**
 * 设置的读写 —— 走 `/api/file/*`，路径在插件自己的 storage 目录下。
 * 内核用 `siyuan.storage` 读同一个文件（真机验证过两边都能读写）。
 */

import { callKernel } from "./blocks";
import { parseSettings, SETTINGS_FILE, type JieshengSettings } from "../settings";

/** 插件名，用来拼 storage 路径 */
export const PLUGIN_NAME = "siyuan-plugin-jiesheng";

const path = `data/storage/petal/${PLUGIN_NAME}/${SETTINGS_FILE}`;

/** 读设置。文件不存在或坏掉都回落默认，不抛。 */
export async function loadSettings(): Promise<JieshengSettings> {
    try {
        const text = await callKernel<unknown>("/api/file/getFile", { path });
        // 该接口返回的是文件原文（不是 {code,data} 信封），可能直接是对象或字符串
        const raw = typeof text === "string" ? text : JSON.stringify(text ?? "");
        return parseSettings(raw);
    } catch {
        return parseSettings(null);
    }
}

/** 写设置 */
export async function saveSettings(s: JieshengSettings): Promise<void> {
    const body = new FormData();
    body.append("path", path);
    body.append("file", new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }), SETTINGS_FILE);
    const res = await fetch("/api/file/putFile", { method: "POST", body });
    const j = (await res.json()) as { code?: number; msg?: string };
    if (j?.code !== 0) {
        throw new Error(j?.msg || "保存设置失败");
    }
}
