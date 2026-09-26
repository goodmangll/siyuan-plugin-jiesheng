/**
 * 内核推送 → 「要不要重载视图」。
 *
 * ## 为什么需要它
 *
 * 原来 `subscribe` 挂在思源的 `ws-main` 上，**收到就整表重载**。但 `ws-main`
 * 是内核**所有**推送的总线，不是「数据变了」。真机静置 10 秒抓到的 cmd：
 *
 *   reloadPlugin / reloadPlugin / backgroundtask / reloadPlugin ...
 *
 * 于是什么都不做的时候，10 秒里也重载了 7 次、发了 49 条 SQL。
 * 加上一次重载是 8 次 IPC（1 列表 + 1 笔记本表 + 6 个计数），空闲时的开销
 * 完全是白烧的，而且会把用户正在看的东西反复冲掉。
 *
 * 真正表示「数据变了」的是 `cmd === "transactions"`，而且里面带得足够细：
 *
 *   {"cmd":"transactions","data":[{"doOperations":[{
 *      "action":"updateAttrs",
 *      "id":"20260101000000-abcdefg","rootID":"20260101000000-abcdefg",
 *      "data":{"new":{"custom-pri":"3",...},"old":{"custom-pri":"2",...}}}]}]}
 *
 * 所以可以只认「任务相关的改动」：改了 `custom-*` / `tags` 属性，
 * 或者建/删/移了文档。**在任务文档里写正文不算** —— 视图不显示正文。
 */

/** 会出现在视图里的任务属性。改这些才需要重载。 */
const TASK_ATTRS = [
    "custom-task", "custom-done", "custom-due", "custom-start", "custom-pri",
    "custom-remind", "custom-repeat", "custom-repeat-from", "custom-list",
    "custom-pin", "custom-abandoned", "custom-spent", "tags",
];

/** 会改变「文档集合」的动作：不重载就会漏掉新增/消失的任务。 */
const DOC_ACTIONS = ["create", "delete", "move", "unfold", "fold", "rename"];

function hasTaskAttr(v: unknown): boolean {
    if (!v || typeof v !== "object") {
        return false;
    }
    const o = v as Record<string, unknown>;
    return TASK_ATTRS.some((k) => k in o);
}

/**
 * 除了 `transactions` 之外，还有两个**精确**信号要认。
 *
 * 真机抓到的内核推送分布（静置 20 秒）：
 *   reloadPlugin ×7 · backgroundtask ×3 · 其它 0
 * —— 前两个是纯噪声（别的插件被覆盖、后台任务进度），
 *    `databaseIndexCommit` 在空闲时**一次都不发**，因为它只在真有东西被索引时才发。
 *
 * - `rename`：文档改名。视图里显示标题，所以必须跟上。
 *   （注意编辑器里改标题**不会**发 `transactions`，只能靠下面那条兜）
 * - `databaseIndexCommit`：索引刚提交 —— 正好是「SQL 追上了写入」的时刻。
 *   它也是「外部改了东西但没发事务」这类情况唯一的兜底信号。
 */
const REFRESH_CMDS = ["rename", "databaseIndexCommit"];

/**
 * 这个内核推送是否**可能**改变视图要显示的内容。
 *
 * 宁可多刷一次也不能漏 —— 漏了就是「改了但界面不动」，那比多刷严重得多。
 * 所以文档级的动作一律算数；只有能明确判断「与任务无关」的才放过。
 */
export function isTaskDataChange(payload: unknown): boolean {
    const p = payload as { cmd?: unknown; data?: unknown } | null | undefined;
    if (!p) {
        return false;
    }
    if (REFRESH_CMDS.includes(String(p.cmd))) {
        return true;
    }
    if (p.cmd !== "transactions") {
        return false;
    }
    const txs = Array.isArray(p.data) ? p.data : [];
    for (const tx of txs) {
        const ops = (tx as { doOperations?: unknown })?.doOperations;
        if (!Array.isArray(ops)) {
            // 结构不认识 —— 保守刷新
            return true;
        }
        for (const op of ops) {
            const o = op as { action?: unknown; data?: unknown } | null;
            if (!o) {
                continue;
            }
            const action = String(o.action ?? "");
            if (DOC_ACTIONS.includes(action)) {
                return true;
            }
            const d = o.data as { new?: unknown; old?: unknown } | undefined;
            if (hasTaskAttr(d?.new) || hasTaskAttr(d?.old)) {
                return true;
            }
        }
    }
    return false;
}
