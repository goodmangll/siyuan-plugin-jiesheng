/**
 * 让右侧面板跟随编辑器光标。
 *
 * 为什么不用 `click-editorcontent`：真机验证发现**点编辑器不会触发它**
 * （按 ⌥⇧D 显式刷新才会更新，说明事件本身没到）。与其赌某一个事件，
 * 改用更可靠的组合：
 *   - DOM 的 `selectionchange` —— 光标一动就发（点击、方向键、鼠标）
 *   - 思源的 `switch-protyle` —— 切换文档
 *
 * `selectionchange` 触发极频繁，所以必须防抖。
 */

export interface FollowScheduler {
    /** 请求一次刷新（会防抖） */
    poke(): void;
    /** 取消待执行的刷新 */
    stop(): void;
}

export function createFollowScheduler(run: () => void, delayMs = 120): FollowScheduler {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        poke() {
            if (timer !== null) {
                return; // 已经排了一次，合并掉
            }
            timer = setTimeout(() => {
                timer = null;
                run();
            }, delayMs);
        },
        stop() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        },
    };
}

/**
 * 光标是不是在编辑器正文里。
 *
 * **必须判这个**：`selectionchange` 在面板自己的输入框里选字也会发 ——
 * 不判的话，在面板里改个标题就会触发一次面板重载，把输入框冲掉。
 */
export function selectionIsInEditor(node: Node | null | undefined): boolean {
    let el: Element | null = null;
    if (!node) {
        return false;
    }
    el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!el) {
        return false;
    }
    if (el.closest(".task-flow-panel")) {
        return false;
    }
    return !!el.closest(".protyle-wysiwyg");
}
