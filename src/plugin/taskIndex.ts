/**
 * 任务 id 的**同步**索引。
 *
 * ## 为什么需要它
 *
 * 思源的 `click-blockicon` 是**同步**事件：`menu.addItem` 必须在回调返回前调用，
 * 否则菜单已经渲染完，后加的项不会出现。而「这个块属不属于一个任务文档」
 * 需要查库（`custom-task="1"`），查不了那么快。
 *
 * 真机踩到的现象：块标菜单里**根本没有「任务」这一项** ——
 * `taskBlockIdFromElement` 只认老的 `- [ ]` 列表项（`data-subtype="t"`），
 * 模型改成「任务 = 文档」之后，它永远返回 null。
 *
 * 所以这里维护一份内存里的 id 集合，供同步查询：
 *   - `onload` 时拉一次（库里的任务文档极少，一条 SQL 就够）
 *   - 内核推送说任务数据变了 → 跟着刷
 *   - 自己改标记（转为任务 / 不再作为任务）→ 就地更新
 *
 * 宁可多刷也不能漏：漏了的表现是「菜单里少了一项」，用户看不出来为什么。
 */

export interface TaskIndexDeps {
    /** 拉全量任务文档 id */
    load(): Promise<string[]>;
    onError?(e: Error): void;
}

export interface TaskIndex {
    /** 同步判断：这个文档是不是任务 */
    has(id: string | null | undefined): boolean;
    /** 重新拉全量 */
    refresh(): Promise<void>;
    /** 就地记下 / 忘掉（自己刚改完标记时用，省一次查询） */
    remember(id: string): void;
    forget(id: string): void;
    /** 当前已知的数量（诊断用） */
    size(): number;
}

export function createTaskIndex(deps: TaskIndexDeps): TaskIndex {
    const ids = new Set<string>();
    return {
        has: (id) => !!id && ids.has(id),
        size: () => ids.size,
        remember: (id) => { ids.add(id); },
        forget: (id) => { ids.delete(id); },
        async refresh() {
            try {
                const list = await deps.load();
                ids.clear();
                for (const id of list) {
                    ids.add(id);
                }
            } catch (e) {
                deps.onError?.(e as Error);
            }
        },
    };
}
