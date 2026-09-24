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

/**
 * 清理「导出正文」，得到可以直接塞回 `createDocWithMd` 的正文。
 *
 * 思源的 `exportMdContent` 会加两样东西：
 *   1. 开头的 YAML frontmatter（`---\ntitle: …\n---`）
 *   2. **标题的 h1**（`# 文档标题`）—— 即便原文没有，它也会加
 * 两样都不能带到新文档里去（真机实测：新文档正文里标题重复了四遍）。
 *
 * ⚠️ 顺带一条同样重要的：`createDocWithMd` 的 markdown **不要再带 `# 标题`** ——
 *    标题由路径给出，markdown 里再写一个 h1，那个 h1 会**原样变成正文里的第一个块**。
 */
export function cleanDocBody(md: string | null | undefined, title?: string): string {
    let s = stripFrontmatter(md ?? "");
    const t = (title ?? "").trim();
    const lines = s.split("\n");
    // 跳过开头的空行
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    const head = (lines[i] ?? "").trim();
    // 只有在 h1 与标题**完全一致**时才去掉 —— 别把用户自己的小标题吃掉
    if (t && /^#\s+/.test(head) && head.replace(/^#\s+/, "").trim() === t) {
        lines.splice(0, i + 1);
        s = lines.join("\n").replace(/^\n+/, "");
    }
    return s;
}

/**
 * 剥掉导出正文的 YAML frontmatter。
 *
 * 思源的 `exportMdContent` 会在正文前面加一段 `---\ntitle: …\n---`。
 * 重复任务要复制上一轮的正文，**这段不能带过去**（否则新文档里会多出一段无意义的元数据）。
 *
 * 找不到配对的结尾就**原样返回** —— 宁可多带一段，也不能把正文吃掉。
 */
export function stripFrontmatter(md: string | null | undefined): string {
    const s = md ?? "";
    if (!s.startsWith("---")) {
        return s;
    }
    const end = s.indexOf("\n---", 3);
    if (end === -1) {
        return s;
    }
    return s.slice(end + 4).replace(/^\n+/, "");
}
