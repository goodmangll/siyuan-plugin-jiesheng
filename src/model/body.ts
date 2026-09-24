/**
 * 任务的「正文」—— 列表项块里除标题与子任务之外的内容。
 *
 * 这是需求讨论 §4 承诺的那一半：同类产品的详情面板 = 标题 + **正文** + 子任务 checklist。
 * 数据模型早就能装（列表项块可以包含任意非文档块，已实测），缺的一直是 UI。
 */

/** 子块的最小信息 */
export interface ChildBlock {
    id: string;
    type: string;
    subtype: string;
    text: string;
}

export interface BodyBlock {
    id: string;
    text: string;
}

/**
 * 挑出正文块。
 *
 * **只认段落**（`type='p'`）：正文区是个纯文本框，段落能原样编辑，
 * 而代码块/标题/表格塞进去就会被压平成纯文本、丢掉结构 —— 那还不如让用户去文档里改。
 * 这类块在视图行上会以「有更多内容」提示，点「定位」跳过去看。
 *
 * `titleParagraphId` 是列表项内层那个装标题的段落，必须排除，否则标题会重复出现在正文里。
 */
export function bodyBlocks(children: ChildBlock[] | null | undefined, titleParagraphId?: string | null): BodyBlock[] {
    return (children ?? [])
        .filter((c) => c.type === "p" && c.id !== titleParagraphId && (c.text ?? "").trim() !== "")
        .map((c) => ({ id: c.id, text: c.text }));
}

/** 正文摘要：列表行上显示一句话，让人知道这条任务里写了东西 */
export function bodySummary(blocks: readonly { text: string; id?: string }[] | null | undefined, max = 60): string {
    const flat = (blocks ?? []).map((b) => (b.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (flat.length === 0) {
        return "";
    }
    const first = flat[0];
    return first.length > max ? first.slice(0, max) + "…" : first;
}
