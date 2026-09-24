import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isUsableWebhook, normalizeSettings, parseSettings } from "../src/settings";

describe("S1 设置解析（坏数据不能让插件崩）", () => {
    it("空内容 → 默认", () => {
        expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
        expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    });
    it("坏 JSON → 默认，不抛", () => {
        expect(parseSettings("{ 这不是 json")).toEqual(DEFAULT_SETTINGS);
    });
    it("缺字段 → 补默认", () => {
        expect(parseSettings('{"webhook":"https://a.com/h"}')).toEqual({
            webhook: "https://a.com/h", inApp: true, desktop: true,
        });
    });
    it("类型不对 → 回落默认（字符串不当布尔用）", () => {
        expect(normalizeSettings({ inApp: "yes", desktop: 1, webhook: 42 })).toEqual(DEFAULT_SETTINGS);
    });
    it("webhook 去空白", () => {
        expect(normalizeSettings({ webhook: "  https://a.com/h  " }).webhook).toBe("https://a.com/h");
    });
});

describe("S2 webhook 形态校验", () => {
    it("http/https 可用", () => {
        expect(isUsableWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x")).toBe(true);
        expect(isUsableWebhook("http://127.0.0.1:8888/hook")).toBe(true);
    });
    it("空 / 非法协议 / 光秃秃的域名 → 不可用", () => {
        expect(isUsableWebhook("")).toBe(false);
        expect(isUsableWebhook(null)).toBe(false);
        expect(isUsableWebhook("ftp://a.com")).toBe(false);
        expect(isUsableWebhook("a.com/hook")).toBe(false);
    });
});
