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

export type FollowReason =
    /** 切换了文档（思源的 `switch-protyle`） */
    | "switch-doc"
    /** 光标动了（`selectionchange` / `click-editorcontent`） */
    | "caret";

export interface FollowScheduler {
    /** 请求一次刷新（会防抖）。同一窗口内出现过 `switch-doc` 就以它为准 */
    poke(reason?: FollowReason): void;
    /** 取消待执行的刷新 */
    stop(): void;
}

export function createFollowScheduler(run: (reason: FollowReason) => void, delayMs = 120): FollowScheduler {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 防抖窗口内可能混进多种来源：只要出现过「切文档」，就按最强的那条算。
    // 不合并的话，切文档引起的 selectionchange 会把 switch-doc 盖掉。
    let sawSwitch = false;
    return {
        poke(reason: FollowReason = "caret") {
            if (reason === "switch-doc") {
                sawSwitch = true;
            }
            if (timer !== null) {
                return; // 已经排了一次，合并掉
            }
            timer = setTimeout(() => {
                const merged: FollowReason = sawSwitch ? "switch-doc" : "caret";
                sawSwitch = false;
                timer = null;
                run(merged);
            }, delayMs);
        },
        stop() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            sawSwitch = false;
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

/* ────────────────────────────────────────────────────────────────────────────
 * 「固定」什么时候解除
 *
 * 面板有两个来源：
 *   1. 在视图里点中一条任务 → **固定**到那条（`pinnedTask`）
 *   2. 否则跟随编辑器光标
 *
 * 最初用「点击位置」当解除信号：监听 document 的 click，只要不在任务 Tab
 * 里就把固定清掉。**真机踩到自噬 bug**：
 *
 *   `openDock()` 是用 `dockItem.click()` 程序化打开面板的，
 *   那次点击同样会冒泡到 document、同样「不在任务 Tab 里」→
 *   刚固定好的任务立刻被这次点击清掉 → 面板永远显示空状态。
 *   （真机日志：
 *      openDetail 设完 pinned=…abcdefg
 *      点击Tab外 → 清 pinned（原=…abcdefg） target=dock__item
 *      currentBlockId → null）
 *
 * 换成「光标真的动了」这个信号就对了：follow 只在 selectionchange /
 * switch-protyle / click-editorcontent 时触发，而**程序化点 dock 图标
 * 一个都不会产生**（真机实测：点一行任务期间 probe 一条都没出）。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 一次可能影响「固定」的信号 */
export type PanelSignal =
    /** 光标落到了**另一个块**，或切了文档 —— 用户真的去看别的任务了 */
    | "caret-moved"
    /** 光标还在原来的块 —— 可能只是重绘，或**我们程序化打开面板**引起的 */
    | "caret-same"
    /** 选区在编辑器之外（面板输入框、侧栏等）—— 不关面板的事 */
    | "selection-outside-editor";

/**
 * 收到一个信号后，「固定」还该不该留着。
 *
 * 返回 `null` 表示解除固定、回到跟随光标。
 */
export function nextPinned(pinned: string | null, signal: PanelSignal): string | null {
    if (!pinned) {
        return null;
    }
    // **只有「光标真的换了个地方」才算用户去看别的任务了。**
    //
    // 为什么不能用 `caret-same`：`openDock()` 是程序化 `dockItem.click()`，
    // 它会诱发一次 selectionchange（锚点仍在原编辑器的文档里）。
    // 若拿它当「用户移动了光标」，刚在视图里点中的那条会立刻被解除 ——
    // 面板看起来永远是空状态。真机踩到过。
    return signal === "caret-moved" ? null : pinned;
}
