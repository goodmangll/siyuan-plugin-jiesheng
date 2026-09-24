/**
 * 设置界面。
 *
 * 用思源原生的 `Setting` 类，和内置插件的设置长得一样。
 * 现在只有三项 —— 提醒的三个开关。**不为了填满界面而加设置项**。
 */

import { Setting } from "siyuan";
import { DEFAULT_SETTINGS, type TaskFlowSettings } from "../settings";

export interface SettingsHost {
    load(): Promise<TaskFlowSettings>;
    save(s: TaskFlowSettings): Promise<void>;
    toast(message: string): void;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.style.cssText = "width:16px;height:16px;cursor:pointer";
    input.addEventListener("change", () => onChange(input.checked));
    return input;
}

function textInput(value: string, placeholder: string, onInput: (v: string) => void): HTMLElement {
    const input = document.createElement("input");
    input.className = "b3-text-field fn__flex-1";
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return input;
}

/** 打开设置。改动**立即保存**（和面板一致，没有"保存"按钮） */
export async function openSettingsDialog(host: SettingsHost): Promise<void> {
    const s: TaskFlowSettings = { ...DEFAULT_SETTINGS, ...(await host.load()) };
    const persist = async (): Promise<void> => {
        try {
            await host.save(s);
        } catch (e) {
            host.toast("任务流：设置保存失败 —— " + ((e as Error)?.message ?? ""));
        }
    };

    const setting = new Setting({ confirmCallback: () => { void persist(); } });

    setting.addItem({
        title: "在思源里弹提醒",
        description: "到点时在右下角弹出提示条",
        createActionElement: () => checkbox(s.inApp !== false, (v) => { s.inApp = v; void persist(); }),
    });

    setting.addItem({
        title: "桌面通知",
        description: "系统级通知。首次需要在弹窗里授权，未授权时不会发（且不会报错）",
        createActionElement: () => checkbox(s.desktop !== false, (v) => {
            s.desktop = v;
            void persist();
            // 权限必须在**用户手势**里请求 —— 这里正好是
            if (v) {
                const N = (window as unknown as { Notification?: typeof Notification }).Notification;
                if (N && N.permission === "default") {
                    void N.requestPermission().then((p) => {
                        host.toast(p === "granted" ? "已授权桌面通知" : "未授权，桌面通知不会发");
                    });
                }
            }
        }),
    });

    setting.addItem({
        title: "Webhook 地址",
        description: "到点时把结构化 JSON POST 到这里。留空则不发。"
            + "指向你自己的转发（N8N / 自建），这样插件不需要持有任何人的 key",
        direction: "column",
        createActionElement: () => textInput(s.webhook ?? "", "https://...", (v) => { s.webhook = v; void persist(); }),
    });

    setting.open("任务流设置");
}
