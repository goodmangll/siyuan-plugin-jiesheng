// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { injectTaskMenu, INJECT_MARK } from "../../src/ui/blockMenuDom";
import type { MenuItemLike } from "../../src/ui/blockMenu";

const ITEMS: MenuItemLike[] = [
    { icon: "iconJiesheng", label: "今天", click: () => undefined },
    { icon: "iconJiesheng", label: "不再作为任务", click: () => undefined },
];

function buildMenu(hidden = false): HTMLElement {
    document.body.innerHTML = "";
    const m = document.createElement("div");
    m.className = "b3-menu" + (hidden ? " fn__none" : "");
    const box = document.createElement("div");
    box.className = "b3-menu__items";
    const it = document.createElement("button");
    it.className = "b3-menu__item";
    it.innerHTML = '<span class="b3-menu__label">转换为</span>';
    box.appendChild(it);
    m.appendChild(box);
    document.body.appendChild(m);
    return m;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("块标菜单补插（思源 3.8.4 的 click-blockicon 晚于渲染）", () => {
    it("把「任务」补进可见菜单，并带上子项", () => {
        buildMenu();
        expect(injectTaskMenu(document, ITEMS, "iconJiesheng")).toBe(true);
        const top = document.querySelector(`[${INJECT_MARK}]`);
        expect(top?.querySelector(".b3-menu__label")?.textContent).toBe("任务");
        const subs = [...document.querySelectorAll("[data-jie-menu-item] .b3-menu__label")]
            .map((n) => n.textContent);
        expect(subs).toEqual(["今天", "不再作为任务"]);
    });

    it("幂等：补两次也只有一份（否则重复点块标会越堆越多）", () => {
        buildMenu();
        injectTaskMenu(document, ITEMS, "iconJiesheng");
        injectTaskMenu(document, ITEMS, "iconJiesheng");
        expect(document.querySelectorAll(`[${INJECT_MARK}]`)).toHaveLength(1);
    });

    it("隐藏的菜单不补（那是思源留下的 #commonMenu 空壳）", () => {
        buildMenu(true);
        expect(injectTaskMenu(document, ITEMS, "iconJiesheng")).toBe(false);
        expect(document.querySelector(`[${INJECT_MARK}]`)).toBeNull();
    });

    it("没有菜单 / 没有项时安静返回 false，不抛", () => {
        document.body.innerHTML = "";
        expect(injectTaskMenu(document, ITEMS, "iconJiesheng")).toBe(false);
        buildMenu();
        expect(injectTaskMenu(document, [], "iconJiesheng")).toBe(false);
    });

    it("点子项会调用对应动作，并把菜单收起来", async () => {
        const clicked: string[] = [];
        const items: MenuItemLike[] = [
            { icon: "i", label: "今天", click: () => { clicked.push("今天"); } },
        ];
        const m = buildMenu();
        injectTaskMenu(document, items, "iconJiesheng");
        const sub = document.querySelector("[data-jie-menu-item]") as HTMLButtonElement;
        sub.click();
        await Promise.resolve();
        expect(clicked).toEqual(["今天"]);
        expect(m.classList.contains("fn__none")).toBe(true);
    });

    it("异步动作抛错不会冒到思源那边", async () => {
        const items: MenuItemLike[] = [
            { icon: "i", label: "炸", click: async () => { throw new Error("boom"); } },
        ];
        buildMenu();
        injectTaskMenu(document, items, "iconJiesheng");
        const sub = document.querySelector("[data-jie-menu-item]") as HTMLButtonElement;
        expect(() => sub.click()).not.toThrow();
        await new Promise((r) => setTimeout(r, 0));
    });

    it("★ 插在**最前面**（追加到末尾会落在菜单底部、超出视口看不见）", () => {
        const m = buildMenu();
        injectTaskMenu(document, ITEMS, "iconJiesheng");
        const box = m.querySelector(":scope > .b3-menu__items")!;
        expect(box.firstElementChild!.getAttribute(INJECT_MARK)).toBe("1");
        expect(box.children[1].className).toContain("b3-menu__separator");
        // 思源自己那一项还在，没被挤掉
        expect([...box.querySelectorAll(".b3-menu__label")].map((n) => n.textContent))
            .toContain("转换为");
    });

    it("★ 子菜单要自己展开（思源靠它自己的 JS 设 display + 定位，不是 CSS）", () => {
        buildMenu();
        injectTaskMenu(document, ITEMS, "iconJiesheng");
        const sub = document.querySelector("[data-jie-menu] .b3-menu__submenu") as HTMLElement;
        expect(sub.style.display).toBe("none");
        document.querySelector(`[${INJECT_MARK}]`)!
            .dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
        expect(sub.style.display).toBe("block");
        expect(sub.style.top).toMatch(/px$/);
        expect(sub.style.left).toMatch(/px$/);
        document.querySelector(`[${INJECT_MARK}]`)!
            .dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
        expect(sub.style.display).toBe("none");
    });
});
