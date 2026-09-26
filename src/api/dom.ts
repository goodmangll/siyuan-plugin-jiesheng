/**
 * DOM 胶水层：从编辑器里取「当前光标所在的块」。
 *
 * 这层很薄且不可单测（依赖真实编辑器 DOM），所以只能靠真机验证 —— 见《M0 验证报告》§4。
 * 取到之后交给 `resolveTaskBlock()` 归一化成任务项。
 *
 * 兜底顺序：
 *   1. `.protyle-wysiwyg--select` —— 块被选中时思源打的类
 *   2. 从 Selection 往上找最近的 [data-node-id]
 *
 * ⚠️ 曾经还有一条「`.protyle-wysiwyg--attr` 上的 data-node-id」的兜底，**真机验证后删掉了**：
 *    那个类会出现在带**文档 id** 的容器上，会遮挡正确的选区路径。
 *    真机日志：attrCount=2、attrId=<文档id>、selectionBlock=<正确的段落块>。
 */
export interface ProtyleLike {
    wysiwyg?: { element?: HTMLElement };
}

export function cursorBlockIdFrom(root: ParentNode = document): string | null {
    const pick = (sel: string): string | null => {
        const el = root.querySelector<HTMLElement>(sel);
        return el?.dataset?.nodeId ?? null;
    };

    // **实时光标优先。**
    //
    // 曾经这里是反过来的：先取 `.protyle-wysiwyg--select`，再退回光标。
    // 真机复现出的后果很严重 —— `--select` 是**会残留的选区标记**：
    // 光标从任务A挪到文档标题后，`--select` 仍指在任务A的段落上，
    // 于是按 ⌥⇧Q 把日期写给了**任务A**（用户正在看的根本不是它）。
    // 选区是「用户选了什么」，光标是「用户现在在哪」，快捷键要的是后者。
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const node = sel?.anchorNode ?? null;
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    const fromCaret = el?.closest?.("[data-node-id]") as HTMLElement | null;
    if (fromCaret?.dataset?.nodeId) {
        return fromCaret.dataset.nodeId;
    }

    // 只有拿不到光标时才退回选区标记（块被整块选中、没有插入点时）
    return pick(".protyle-wysiwyg--select");
}

/** 从活动编辑器里取光标块；拿不到活动编辑器则回退到整页查找 */
export function cursorBlockId(activeEditor?: ProtyleLike | null): string | null {
    const scope = activeEditor?.wysiwyg?.element;
    return cursorBlockIdFrom(scope ?? document);
}

/**
 * 从块元素向上找「所属的任务列表项」（老模型的 `- [ ]`）。
 *
 * 用 `closest` 向上找，所以嵌套任务会命中**最近的那一层**，正是我们要的。
 */
export const TASK_ITEM_SELECTOR = '[data-node-id][data-subtype="t"]';

/**
 * 块标菜单点击时，从 DOM **同步**得到「点的是什么」。
 *
 * ## 为什么要有这个
 *
 * 真机上块标菜单里**根本没有「任务」这一项**。根因：原来只用
 * `taskBlockIdFromElement`（只认 `[data-subtype="t"]`，即老模型的 `- [ ]`），
 * 而模型已经改成「**任务 = 文档**」——它永远返回 null，菜单就一直不挂。
 *
 * 但也不能一上来就查库：`click-blockicon` 是**同步**事件，
 * `menu.addItem` 必须在回调返回前调用。所以这里只做纯 DOM 的事：
 *
 * - `blockId`：最近的 `[data-node-id]`
 * - `docId`：所属文档。思源把文档 id 放在 `.protyle` 的 `data-node-id` 上
 *   （实测；文档块自己不是 `data-type="NodeDocument"` 的 wysiwyg 子元素）
 * - `isTaskItem`：是不是 `- [ ]` 列表项（老模型遗留）
 *
 * 「这个文档是不是任务」由调用方拿同步的任务 id 索引去判（见 `plugin/taskIndex.ts`）。
 */
export interface BlockHit {
    blockId: string | null;
    docId: string | null;
    isTaskItem: boolean;
}

export function blockHitFromElement(el: Element | null | undefined): BlockHit {
    const empty: BlockHit = { blockId: null, docId: null, isTaskItem: false };
    if (!el || typeof el.closest !== "function") {
        return empty;
    }
    const nodeId = (n: Element | null): string | null =>
        ((n as HTMLElement | null)?.dataset?.nodeId ?? null) || null;
    return {
        blockId: nodeId(el.closest("[data-node-id]")),
        docId: nodeId(el.closest(".protyle")),
        isTaskItem: !!el.closest(TASK_ITEM_SELECTOR),
    };
}

/** 兼容旧用法：只要「所属的任务列表项」 */
export function taskBlockIdFromElement(el: Element | null | undefined): string | null {
    const hit = blockHitFromElement(el);
    return hit.isTaskItem ? hit.blockId : null;
}

/**
 * 当前被整块选中的块数。
 *
 * 用于 T18：插件只作用于**光标所在的那一个**块，多选时既不会全都生效、
 * 也不该装作没看见。命令层据此给出一次明确提示，把「隐性半生效」变成
 * 「显式不支持」—— 这正是设计里允许的处置。
 */
export function countSelectedBlocks(root: ParentNode = document): number {
    return root.querySelectorAll(".protyle-wysiwyg--select").length;
}
