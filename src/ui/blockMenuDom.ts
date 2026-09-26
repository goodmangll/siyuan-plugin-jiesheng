/**
 * 把「任务 ▸」补进**已经被渲染出来**的块标菜单里。
 *
 * ## 为什么需要这个「补」字
 *
 * 思源的 `click-blockicon` 本来是给插件往块标菜单加项用的，官方写法是
 * `event.detail.menu.addItem({icon, label, click})`。但在**思源 3.8.4** 上，
 * 这个事件的触发**晚于菜单渲染**，于是 `addItem` 只写进了数据（`menu.menus`）、
 * 没进 DOM。真机证据：
 *
 * ```
 * [bm] 加完:        menus = 自定义块样式 / 任务（测试项）
 * [bm] +50ms 晚加完: menus = 自定义块样式 / 任务 / 任务（晚加） | DOM有=false
 * ```
 *
 * 而且**不是我们的用法问题** —— 另一个独立插件 `siyuan-plugin-task-list`
 * 用的是完全一样的写法，它的项同样不出现（两个插件同时装了，菜单里都没有）。
 *
 * ## 所以
 *
 * 先照官方写法 `addItem`（万一以后思源修好了，这条路会自然生效），
 * 然后在下一个 tick 检查「我们的项进 DOM 了吗」：没进就按思源自己的标记
 * 手工补一个进去。标记是 `data-jie-menu`，据此幂等 —— 重复调用不会补两次。
 *
 * ⚠️ 这里用的是思源的**内部 class**（`b3-menu__item` 等）。它是一份工作区，
 *    思源修好事件顺序之后应当删掉这段。判断依据：`data-jie-menu` 已经在 DOM 里
 *    出现了，就说明官方那条路通了。
 */

import type { MenuItemLike } from "./blockMenu";

/** 我们补进去的项上的标记，用来判幂等 / 判官方那条路有没有通 */
export const INJECT_MARK = "data-jie-menu";

/** 子项上的标记 */
const SUB_MARK = "data-jie-menu-item";

function visibleTopMenu(doc: Document): HTMLElement | null {
    const menus = [...doc.querySelectorAll<HTMLElement>(".b3-menu")]
        .filter((m) => !m.classList.contains("fn__none"));
    // 顶层菜单：直接子级就是 .b3-menu__items，且里面有菜单项
    return menus.find((m) => {
        const box = m.querySelector(":scope > .b3-menu__items");
        return !!box && box.querySelectorAll(":scope > .b3-menu__item").length > 0;
    }) ?? null;
}

function el<K extends keyof HTMLElementTagNameMap>(
    doc: Document, tag: K, cls: string, text?: string,
): HTMLElementTagNameMap[K] {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== undefined) {
        n.textContent = text;
    }
    return n;
}

function icon(doc: Document, href: string, small = false): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("class", small ? "b3-menu__icon b3-menu__icon--small" : "b3-menu__icon");
    const use = doc.createElementNS(NS, "use");
    use.setAttribute("xlink:href", href);
    svg.appendChild(use);
    return svg;
}

/** 点完之后把菜单收起来（思源自己的项会调 menu.close()，我们只拿到数据对象，收不了） */
function closeMenus(doc: Document): void {
    for (const m of doc.querySelectorAll<HTMLElement>(".b3-menu")) {
        if (!m.classList.contains("fn__none")) {
            m.classList.add("fn__none");
        }
    }
}

/**
 * 补进可见的块标菜单。
 *
 * @returns 补进去了（或本来就在）返回 true；没有可见菜单返回 false。
 */
export function injectTaskMenu(
    doc: Document,
    items: MenuItemLike[],
    iconHref: string,
): boolean {
    if (items.length === 0) {
        return false;
    }
    const menu = visibleTopMenu(doc);
    if (!menu) {
        return false;
    }
    if (menu.querySelector(`[${INJECT_MARK}]`)) {
        return true; // 幂等：已经补过（或官方那条路通了）
    }
    const box = menu.querySelector(":scope > .b3-menu__items");
    if (!box) {
        return false;
    }

    // 「任务」这一层
    const top = el(doc, "button", "b3-menu__item");
    top.setAttribute(INJECT_MARK, "1");
    top.appendChild(icon(doc, iconHref));
    top.appendChild(el(doc, "span", "b3-menu__label", "任务"));
    top.appendChild(icon(doc, "#iconRight", true));

    const subWrap = el(doc, "div", "b3-menu__submenu");
    const subBox = el(doc, "div", "b3-menu__items b3-menu__items--menu");
    for (const it of items) {
        const b = el(doc, "button", "b3-menu__item");
        b.setAttribute(SUB_MARK, "1");
        b.appendChild(icon(doc, it.icon || iconHref));
        b.appendChild(el(doc, "span", "b3-menu__label", it.label));
        b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            closeMenus(doc);
            void Promise.resolve(it.click()).catch(() => undefined);
        });
        subBox.appendChild(b);
    }
    subWrap.appendChild(subBox);
    top.appendChild(subWrap);

    // ★ 插在**最前面**：追加到末尾会落在菜单底部，实测超出视口看不见
    box.insertBefore(top, box.firstChild);
    box.insertBefore(el(doc, "button", "b3-menu__separator"), top.nextSibling);

    // ★ 子菜单要自己展开：思源的子菜单不是靠 CSS，而是它自己的 JS 设
    //   `display:block` + 内联 top/left（真机量的：悬停前 display=none，
    //   悬停后 display=block、style="top: 263px; left: 350px"）。
    //   我们只拿到数据对象、拿不到它的 Menu 实例，所以这段得自己写。
    subWrap.style.display = "none";
    const show = (): void => {
        const r = top.getBoundingClientRect();
        subWrap.style.display = "block";
        subWrap.style.top = `${Math.round(r.top)}px`;
        subWrap.style.left = `${Math.round(r.right)}px`;
        const w = subWrap.getBoundingClientRect().width;
        const vw = doc.defaultView?.innerWidth ?? 0;
        if (vw > 0 && r.right + w > vw) {
            subWrap.style.left = `${Math.round(r.left - w)}px`; // 右边放不下就翻到左边
        }
    };
    const hide = (): void => {
        subWrap.style.display = "none";
    };
    top.addEventListener("mouseenter", show);
    top.addEventListener("mouseleave", hide);
    subWrap.addEventListener("mouseleave", hide);
    return true;
}
