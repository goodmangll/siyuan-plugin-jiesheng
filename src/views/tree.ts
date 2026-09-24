/**
 * 任务树 —— 从 `hpath` 还原层级。
 *
 * ⚠️ **思源的文档树不用 `parent_id`**（真机实测：文档的 parent_id 都是空的），
 *    层级完全由 `hpath` 表达：
 *      /工作
 *      /工作/周报
 *      /工作/周报/九月
 *    所以深度、父子关系全部从路径算。
 *
 * ★ 「任务 = 文档」模型下，**子任务 = 子文档**，无限递归。这一层负责把
 *   扁平的查询结果还原成"父在前、子紧随"的有序列表，让视图能缩进显示。
 */

export interface TreeInput {
    id: string;
    /** 文档路径，如 `/工作/周报` */
    path: string;
}

export interface TreeNode<T extends TreeInput = TreeInput> {
    task: T;
    /** 1 = 顶层文档，2 = 子文档，3 = 孙文档… */
    depth: number;
    /** 父路径；顶层为空串 */
    parentPath: string;
    /** 直属子任务数（只数在**本次结果集**里的，没查出来的不算） */
    childCount: number;
    /** 是否被折叠（由调用方传入的折叠集合决定） */
    collapsed: boolean;
}

const norm = (p: string): string => {
    const s = (p ?? "").trim();
    if (!s) return "";
    return s.startsWith("/") ? s : "/" + s;
};

/** 路径层级：`/a` → 1，`/a/b` → 2，`/a/b/c` → 3。空路径 → 0 */
export function depthOf(path: string): number {
    const p = norm(path);
    if (!p) return 0;
    return p.split("/").filter(Boolean).length;
}

/** 路径最后一段（就是文档名） */
export function pathNameOf(path: string): string {
    const p = norm(path);
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
}

/** 父路径；顶层文档返回空串 */
export function parentPathOf(path: string): string {
    const p = norm(path);
    if (!p) return "";
    const idx = p.lastIndexOf("/");
    return idx <= 0 ? "" : p.slice(0, idx);
}

/**
 * 把扁平的任务列表还原成树，返回**已按显示顺序排好**的列表。
 *
 * 排序规则：按路径的每一段依次比较（父必定排在子前面），同路径保持传入顺序。
 * 父任务不在结果集里时，子任务**照样出现** —— 否则「今天」会漏掉
 * 「父任务不今天到期、子任务今天到期」这种真实情况。
 *
 * @param collapsedIds 被折叠的节点 id 集合；被折叠节点的**后代全部隐藏**
 */
export function buildTree<T extends TreeInput>(
    tasks: T[] | null | undefined,
    collapsedIds?: Set<string> | null,
): TreeNode<T>[] {
    const list = (tasks ?? []).filter((t) => t && t.id);
    if (!list.length) {
        return [];
    }

    const collapsed = collapsedIds ?? new Set<string>();

    // 按父路径分桶，**桶内保持传入顺序** —— 传入顺序就是 SQL 的排序
    // （置顶 → 优先级 → 截止日），这个顺序**不能**被树的遍历打乱。
    //
    // 曾经这里是「按路径全局排序」，结果 custom-pin 的排序完全失效：
    // 真机实测置顶的任务在 SQL 里排第 1，视图里却不在第一位。
    const byParent = new Map<string, T[]>();
    const paths = new Set(list.map((t) => norm(t.path)));
    for (const t of list) {
        const pp = parentPathOf(t.path);
        const arr = byParent.get(pp);
        if (arr) {
            arr.push(t);
        } else {
            byParent.set(pp, [t]);
        }
    }

    // 直属子任务数
    const childCount = new Map<string, number>();
    for (const t of list) {
        const pp = parentPathOf(t.path);
        childCount.set(pp, (childCount.get(pp) ?? 0) + 1);
    }

    const out: TreeNode<T>[] = [];
    const emit = (parent: string, ancestors: Set<string>): void => {
        for (const t of byParent.get(parent) ?? []) {
            const p = norm(t.path);
            const isCollapsed = collapsed.has(t.id);
            out.push({
                task: t,
                depth: depthOf(p),
                parentPath: parent,
                childCount: childCount.get(p) ?? 0,
                collapsed: isCollapsed,
            });
            // 折叠 → 不再往下走；ancestors 兼作防御，路径异常时不会死循环
            if (!isCollapsed && !ancestors.has(p)) {
                ancestors.add(p);
                emit(p, ancestors);
                ancestors.delete(p);
            }
        }
    };

    // 根：父路径不在结果集里（顶层文档，或父任务不在本次筛选结果中）
    const roots = new Set<string>();
    for (const t of list) {
        const pp = parentPathOf(t.path);
        if (!paths.has(pp)) {
            roots.add(pp);
        }
    }
    // 根之间按路径排序（没有任何排序信息可用时的稳定兜底）
    for (const r of [...roots].sort()) {
        emit(r, new Set());
    }
    return out;
}
