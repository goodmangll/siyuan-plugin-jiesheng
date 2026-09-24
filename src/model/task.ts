/**
 * 任务块：kramdown 层面的操作。
 *
 * M0 实测的 kramdown 形态（**注意 ial 在标记之前**，且勾选后是大写 X）：
 *   - {: id="A" updated="..."}[ ] 标题      未完成
 *   - {: id="A" updated="..."}[X] 标题      已完成
 *
 * 数据库表 blocks.markdown 里则是规范化的 `- [ ] 标题` / `- [X] 标题`。
 * 两种都要认，但写回 `updateBlock` 时用的是 kramdown。
 */

/**
 * 匹配任务列表项的**首行**：
 *   group1 = `- ` 加上可选的 ial
 *   group2 = 标记本身
 *   group3 = 标题与后续内容
 */
// 前缀整段（含缩进）作为捕获组 1：嵌套任务的 markdown 带缩进，
//   - 识别时要容忍缩进
//   - 切换完成状态时要**原样保留**缩进，否则嵌套结构会被压平
const TASK_LINE_RE = /^(\s*-\s+(?:\{:[^}]*\}\s*)?)(\[ \]|\[[xX]\])/;

/** 首行是不是任务标记 */
export function isTaskKramdown(kramdown: string | null | undefined): boolean {
    if (typeof kramdown !== "string") {
        return false;
    }
    return TASK_LINE_RE.test(kramdown.split("\n", 1)[0]);
}

/** 当前是否已完成（无标记时为 false） */
export function isDone(kramdown: string): boolean {
    const m = TASK_LINE_RE.exec(kramdown.split("\n", 1)[0]);
    return !!m && m[2].toLowerCase() === "[x]";
}

/**
 * 切换完成状态：**只改首行的标记**，其余字节原样保留（ial、子块、正文、引述块都不动）。
 * 非任务块返回 null。
 */
export function setTaskDone(kramdown: string | null | undefined, done: boolean): string | null {
    if (typeof kramdown !== "string") {
        return null;
    }
    const nl = kramdown.indexOf("\n");
    const first = nl === -1 ? kramdown : kramdown.slice(0, nl);
    const rest = nl === -1 ? "" : kramdown.slice(nl);
    const m = TASK_LINE_RE.exec(first);
    if (!m) {
        return null;
    }
    const next = m[1] + (done ? "[X]" : "[ ]") + first.slice(m[0].length);
    return next + rest;
}

/**
 * 子任务判定：父级是列表块、**祖父是任务项**。
 * 顶层任务的父级是列表块、祖父是标题或文档。
 *
 * 直接用 SQL 表达就是：
 *   not exists (
 *     select 1 from blocks p join blocks g on g.id = p.parent_id
 *     where p.id = b.parent_id and p.type='l' and g.type='i' and g.subtype='t'
 *   )
 */
export function isSubtask(types: {
    parentType?: string | null;
    grandType?: string | null;
    grandSubtype?: string | null;
}): boolean {
    return types.parentType === "l" && types.grandType === "i" && types.grandSubtype === "t";
}

/**
 * 从任务块的 kramdown 里取标题。
 *
 * 用 kramdown 而不是 `blocks.content`：列表项块的 `content` **包含后代文本**，
 * 拿它当标题会把子任务和正文一起带上。
 * kramdown 的首行则是 `- {: id="…"}[ ] 标题` 这个干净形态。
 */
export function taskTitleFromKramdown(kramdown: string | null | undefined): string {
    if (typeof kramdown !== "string") {
        return "";
    }
    const first = kramdown.split("\n", 1)[0];
    const m = TASK_LINE_RE.exec(first);
    if (!m) {
        return first.trim();
    }
    return first.slice(m[0].length).trim();
}
