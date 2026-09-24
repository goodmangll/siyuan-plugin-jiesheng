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

    const selected = pick(".protyle-wysiwyg--select");
    if (selected) {
        return selected;
    }
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const node = sel?.anchorNode ?? null;
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    const pb = el?.closest?.("[data-node-id]") as HTMLElement | null;
    return pb?.dataset?.nodeId ?? null;
}

/** 从活动编辑器里取光标块；拿不到活动编辑器则回退到整页查找 */
export function cursorBlockId(activeEditor?: ProtyleLike | null): string | null {
    const scope = activeEditor?.wysiwyg?.element;
    return cursorBlockIdFrom(scope ?? document);
}
