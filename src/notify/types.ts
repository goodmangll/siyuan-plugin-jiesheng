/**
 * 提醒的抽象层类型。
 *
 * **这一层只定形状，不含任何通道实现。**
 * 接一个具体通道（企业微信机器人 / Bark / Server酱 / Telegram / 钉钉…）
 * = 实现下面这个 `NotifyChannel`，然后在配置里给它一份 config。
 */

import type { Priority } from "../model/priority";

/** 一条「该在什么时候推什么」 */
export interface RemindEvent {
    /** 任务块 id */
    blockId: string;
    title: string;
    /** 提醒时刻，`yyyyMMddHHmm`（绝对时刻，见 model/remind 的设计说明） */
    remindAt: string;
    /** 截止时刻，`yyyyMMdd` 或 `yyyyMMddHHmm` */
    due?: string;
    /** 优先级档位 */
    pri?: Priority;
    /** 轻量清单名 */
    list?: string;
}

/** 一条任务记录（来自 SQL 查询，字段名与库一致） */
export interface TaskRow {
    id: string;
    title: string;
    /** 空格分隔的绝对时刻列表 */
    remind?: string;
    due?: string;
    /** 原始优先级属性值 1/2/3 */
    pri?: string;
    list?: string;
}

export type NotifyResult = { ok: boolean; detail?: string };

/** 一个推送目的地 */
export interface NotifyChannel {
    /** 稳定标识，用于配置键名 */
    readonly id: string;
    /** 面板上显示的名字 */
    readonly label: string;
    /** 需要哪些配置项（面板据此渲染输入框） */
    configKeys(): string[];
    send(event: RemindEvent, config: Record<string, string>): Promise<NotifyResult>;
}

/** 每个通道一份配置：`{ [channelId]: { ...configKeys } }` */
export type ChannelConfig = Record<string, Record<string, string>>;

export interface DispatchResult {
    channelId: string;
    ok: boolean;
    detail?: string;
}
