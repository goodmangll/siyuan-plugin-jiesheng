/**
 * 编辑器会话：面板跟谁走、跳到哪里、开哪个面板/标签。
 *
 * 这一层管的是「用户此刻在看哪条任务」这一小撮状态，以及由它派生的动作。
 * 抽出来是因为它有三条真机踩出来的规则，值得独立成模块 + 注释：
 *
 * 1. **面板的两个来源**：视图里点中的那条（固定）/ 否则跟随编辑器光标。
 * 2. **解除固定的判据是「光标换了个块」，不是「点了哪里」** ——
 *    `openDock()` 是程序化 `dockItem.click()`，用点击位置判断会把自己的固定清掉。
 * 3. **「打开面板后该聚焦哪个字段」用「取走」而不是「读」** ——
 *    否则面板每次重渲染都会重新抢焦点。
 */

import { nextPinned, type FollowReason } from "../ui/follow";

export interface SessionDeps {
    /** 插件的 frontend 名字（拼 Tab / Dock 的 data-type）；惰性取，字段初始化时它可能还没就位 */
    pluginName(): string;
    tabType: string;
    dockType: string;
    /** 当前光标所在的块（未归一化到任务） */
    rawCaret(): string | null;
    /** 把任意块归一化到「它所属的任务文档」 */
    resolveTask(blockId: string): Promise<string | null>;
    /** 跳到某个块（打开所在文档并定位） */
    openBlock(id: string): void;
    /** 面板刷新 */
    refreshPanel(): void;
    /** 打开右侧面板 */
    expandDock(): void;
    /** 提示 */
    toast(message: string, ms?: number): void;
    /** 任务视图 Tab 的标题 */
    tabTitle: string;
    tabIcon: string;
    /**
     * 开一个全屏 Tab。
     *
     * 注入而不是直接 `import { openTab } from "siyuan"` —— 那样这个模块
     * 就没法在测试环境加载（`siyuan` 包没有可解析的入口，真机踩到）。
     * 它本来也不需要知道思源的存在，只需要「给我开个 Tab」。
     */
    openTab(opts: { id: string; icon: string; title: string }): void;
}

export interface EditorSession {
    /** 视图里点中的那条（固定）；没有则跟随光标 */
    pinned(): string | null;
    pin(id: string): void;
    /** 面板当前该显示哪条任务 */
    currentBlockId(): Promise<string | null>;
    /** 收到一次「光标可能动了」的信号 */
    onFollow(reason: FollowReason): Promise<void>;
    /** 取走一次「打开面板后聚焦哪个字段」的请求，取过即清 */
    takeFocus(): string | null;
    /** 打开面板并（可选）让某个字段拿焦点 */
    openPanel(focus?: string): void;
    /** 打开任务视图 Tab */
    openTab(): void;
}

export function createSession(deps: SessionDeps): EditorSession {
    let pinned: string | null = null;
    let lastCaret: string | null = null;
    let pendingFocus: string | null = null;

    return {
        pinned: () => pinned,

        pin(id) {
            pinned = id;
        },

        currentBlockId: async () => pinned ?? await resolveCaret(),

        async onFollow(reason) {
            // 判据是「光标**换了个块**（或切了文档）」，不是「点了哪里」——
            // `openDock()` 是程序化 `dockItem.click()`，用点击位置判断会把
            // 自己的固定清掉（见 ui/follow.ts 里那段自噬 bug 的记录）。
            const caret = deps.rawCaret();
            const moved = reason === "switch-doc" || caret !== lastCaret;
            lastCaret = caret;
            pinned = nextPinned(pinned, moved ? "caret-moved" : "caret-same");
            deps.refreshPanel();
        },

        takeFocus() {
            const f = pendingFocus;
            pendingFocus = null;
            return f;
        },

        openPanel(focus) {
            pendingFocus = focus ?? "due";
            deps.refreshPanel();
            deps.expandDock();
        },

        openTab() {
            try {
                deps.openTab({
                    id: deps.pluginName() + deps.tabType,
                    icon: deps.tabIcon,
                    title: deps.tabTitle,
                });
            } catch (e) {
                deps.toast("结绳：Tab 打开失败 —— " + (e as Error).message, 5000);
            }
        },
    };

    async function resolveCaret(): Promise<string | null> {
        const cur = deps.rawCaret();
        return cur ? await deps.resolveTask(cur) : null;
    }
}

