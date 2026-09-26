/**
 * 插件入口 —— **只做装配**。
 *
 * 这里不写业务逻辑：命令表在 `commands.ts`，写操作在 `plugin/actions.ts`，
 * 宿主适配器在 `plugin/hosts.ts`，编辑器会话在 `plugin/session.ts`，
 * 提醒守护在 `plugin/reminder.ts`。
 *
 * 之所以这么切：原来这些都长在这个类上（825 行），每次改动都要翻半天，
 * 而且为了测一段逻辑得把整个插件构造出来。现在每一层都是「函数 + 显式依赖」，
 * 各自能单测。
 */

import { Plugin, fetchSyncPost, getActiveEditor, openTab, showMessage } from "siyuan";
import { blockHitFromElement, cursorBlockId, type ProtyleLike } from "./api/dom";
import { callKernel, setTransport, type KernelResponse } from "./api/blocks";
import { COMMANDS } from "./commands";
import { DEFAULT_SETTINGS, type JieshengSettings } from "./settings";
import { loadSettings, saveSettings } from "./api/settings";
import { toDateStr } from "./model/date";
import { createFollowScheduler, selectionIsInEditor } from "./ui/follow";
import { mountTab, type TabHandle } from "./views/mountTab";
import { mountTaskPanel, type TaskPanelHandle } from "./ui/mountPanel";
import { openSettingsDialog } from "./ui/settingsDialog";
import { resolveTaskBlock } from "./api/blocks";
import { buildBlockMenuItems } from "./ui/blockMenu";
import { injectTaskMenu } from "./ui/blockMenuDom";
import { generateNextRepeat } from "./generate";
import * as actions from "./plugin/actions";
import { createSession } from "./plugin/session";
import { createReminderDaemon, notifyDesktop } from "./plugin/reminder";
import { createTaskIndex, type TaskIndex } from "./plugin/taskIndex";
import { isTaskDataChange } from "./views/txFilter";
import { runSql } from "./api/blocks";
import {
    buildBlockMenuDeps, buildCommandDeps, buildPanelHost, buildViewHost, type HostDeps,
} from "./plugin/hosts";

const TAB_TYPE = "jieTab";
const DOCK_TYPE = "jieDock";

const ICON = '<symbol id="iconJiesheng" viewBox="0 0 32 32">'
    + '<path d="M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26zm0 3a10 10 0 1 1 0 20 10 10 0 0 1 0-20z"/>'
    + '<circle cx="16" cy="16" r="3.4"/></symbol>';

export default class Jiesheng extends Plugin {
    private panel: TaskPanelHandle | null = null;
    private tab: TabHandle | null = null;

    private transportReady = false;
    private settings: JieshengSettings = { ...DEFAULT_SETTINGS };

    /**
     * 任务 id 的**同步**索引（块标菜单要同步判断「这个文档是不是任务」）。
     * 见 plugin/taskIndex.ts 里的说明 —— 不加它菜单里就根本没有「任务」这一项。
     */
    private taskIndex: TaskIndex = createTaskIndex({
        load: async () => {
            const rows = await runSql<{ id: string }>(
                `select b.id from blocks b where b.type='d' and
                 exists (select 1 from attributes a where a.block_id=b.id and a.name='custom-task' and a.value='1')`,
            );
            return rows.map((r) => r.id);
        },
        onError: (e) => console.log("[结绳] 任务索引刷新失败: " + e.message),
    });

    /** 笔记本表缓存：几乎不变，但每次 load 都拉一次是白花一个 IPC */
    private notebookCache: { at: number; map: Record<string, string> } | null = null;

    private daemon = createReminderDaemon({
        wantsInApp: () => this.settings.inApp !== false,
        wantsDesktop: () => this.settings.desktop !== false,
        toast: (m) => showMessage(m, 6000),
        notifyDesktop,
    });

    private session = createSession({
        pluginName: () => this.name,
        openTab: ({ id, icon, title }) => {
            void openTab({ app: this.app, custom: { id, icon, title } });
        },
        tabType: TAB_TYPE,
        dockType: DOCK_TYPE,
        tabTitle: "任务",
        tabIcon: "iconJiesheng",
        rawCaret: () => this.rawCaretBlockId(),
        resolveTask: (id) => resolveTaskBlock(id),
        openBlock: (id) => this.openBlock(id),
        refreshPanel: () => this.panel?.refresh(),
        expandDock: () => this.openDock(),
        toast: (m, ms) => showMessage(m, ms),
    });

    async onload(): Promise<void> {
        // transport：思源的 fetchPost 返回的是 data 本身，不是 {code,msg,data} 信封（M0 实测），
        // 这里把它重新包成 api 层期望的形状。
        // ⚠️ 必须用 fetchSyncPost：`fetchPost(url, data)` 在**不带回调**时 resolve 的是 undefined
        //    （真机踩到的坑，M0 探针里也出现过同样现象）。
        const post = fetchSyncPost as unknown as (url: string, data?: unknown) => Promise<KernelResponse>;
        setTransport(async (url, data) => await post(url, data ?? {}));
        this.transportReady = true;

        this.addIcons(ICON);

        const deps: HostDeps = {
            session: this.session,
            notebookMap: () => this.notebookMap(),
            todayStr: () => toDateStr(new Date()),
            eventBus: this.eventBus,
            openBlock: (id) => this.openBlock(id),
            openSettings: () => this.openSetting(),
            toggleDone: (id) => this.toggleDone(id),
            afterCompleted: (id) => this.afterCompleted(id),
            createTask: (title, due) => this.createTask(title, due),
            promoteToTask: (id) => this.promoteToTask(id),
            forgetTask: (id) => this.taskIndex.forget(id),
            transportReady: () => this.transportReady,
            toast: (m, ms) => showMessage(m, ms ?? 3000),
            errorToast: (m) => showMessage(m, 4000, "error"),
        };

        // 命令表（10 个 ⌥⇧ 快捷键 + 打开设置）
        const cmdDeps = buildCommandDeps(deps);
        for (const cmd of COMMANDS) {
            this.addCommand({
                langKey: cmd.langKey,
                langText: cmd.langText,
                hotkeys: cmd.hotkeys,
                execute: () => {
                    void cmd.run(cmdDeps).catch((e) => {
                        // 命令出错不能让编辑器崩：提示一下就行
                        showMessage("结绳：" + ((e as Error).message || "执行失败"), 5000, "error");
                    });
                },
            });
        }

        // 任务索引：块标菜单要**同步**知道某个文档是不是任务
        await this.taskIndex.refresh();

        // 任务索引跟着「任务数据真的变了」刷新（和视图用同一个信号，见 views/txFilter）
        this.eventBus.on("ws-main", (event: CustomEvent) => {
            if (isTaskDataChange(event?.detail)) {
                void this.taskIndex.refresh();
            }
        });

        this.setupFollow();
        this.setupBlockMenu(deps);
        this.setupDock(deps);
        this.setupTab(deps);

        // 提醒：**前端这一份只在界面打开时跑**，且用自己的游标（见 plugin/reminder.ts）
        try {
            await this.loadSettingsOnce();
            this.daemon.start();
        } catch (e) {
            showMessage("结绳：提醒启动失败 —— " + (e as Error).message, 5000, "error");
        }
    }

    onunload(): void {
        this.daemon.stop();
        this.panel?.unmount();
        this.panel = null;
        this.tab?.unmount?.();
        this.tab = null;
    }

    /**
     * 设置入口 —— 思源会在插件列表里显示一个齿轮，点它就调这里。
     * 用原生 Setting 类，和内置插件的设置长得一样。
     */
    openSetting(): void {
        void openSettingsDialog({
            load: () => loadSettings(),
            save: async (s) => {
                await saveSettings(s);
                this.settings = s; // 立刻生效，不用重启
            },
            toast: (m: string) => showMessage(m, 3000),
        });
    }

    /* ── 装配细节 ────────────────────────────────────────────────────────── */

    /**
     * 面板跟随编辑器光标。
     *
     * ⚠️ 真机验证发现：**点编辑器不会触发 `click-editorcontent`**
     *    （点完面板纹丝不动，按 ⌥⇧D 显式刷新才更新），所以不能只靠它。
     *    改用更可靠的组合：DOM 的 `selectionchange`（光标一动就发）
     *    + 思源的 `switch-protyle`（切文档）。防抖与「解除固定」的判据见 ui/follow.ts。
     */
    private setupFollow(): void {
        const follow = createFollowScheduler(async (reason) => {
            const sel = window.getSelection();
            if (!selectionIsInEditor(sel?.anchorNode ?? null)) {
                return; // 在面板自己的输入框里选字，不该刷新
            }
            await this.session.onFollow(reason);
        });
        document.addEventListener("selectionchange", () => follow.poke("caret"), true);
        this.eventBus.on("switch-protyle", () => follow.poke("switch-doc"));
        this.eventBus.on("click-editorcontent", () => follow.poke("caret"));
    }

    /** 块标菜单 →「任务 ▸」子菜单。必须**同步** addItem：事件返回后思源立刻渲染菜单。 */
    private setupBlockMenu(deps: HostDeps): void {
        this.eventBus.on("click-blockicon", (event) => {
            try {
                const { blockElements } = event.detail;
                // 同步判断「点的是什么」（click-blockicon 必须在返回前加完项）
                const hit = blockHitFromElement(blockElements?.[0] ?? null);
                // 任务 = 文档：文档带 custom-task 才算任务；否则给「转为任务」
                const inTaskDoc = this.taskIndex.has(hit.docId);
                const id = inTaskDoc ? hit.docId : hit.blockId;
                const items = buildBlockMenuItems(
                    id ? { id, isTask: inTaskDoc } : null,
                    buildBlockMenuDeps(deps),
                );
                if (!items.length) {
                    return;
                }
                // 思源 3.8.4 的 click-blockicon 触发**晚于菜单渲染**，官方写法的
                // addItem 只进数据不进 DOM（另一个独立插件同样如此，见 ui/blockMenuDom.ts）。
                // 所以这里先照官方写法加一遍，下一个 tick 再确认进没进 DOM。
                const menu = event.detail.menu as unknown as {
                    addSeparator?: () => void;
                    addItem?: (o: unknown) => void;
                };
                menu.addSeparator?.();
                for (const it of items) {
                    menu.addItem?.({
                        icon: it.icon,
                        label: it.label,
                        click: () => { void it.click(); },
                    });
                }
                setTimeout(() => {
                    injectTaskMenu(document, items, "iconJiesheng");
                }, 0);
            } catch (e) {
                // 别静默吞：这里出错的表现就是「菜单里根本没有『任务』」
                console.log("[结绳] 块标菜单构建失败: " + String((e as Error)?.message ?? e));
            }
        });
    }

    private setupDock(deps: HostDeps): void {
        try {
            this.addDock({
                id: DOCK_TYPE,
                type: DOCK_TYPE,
                config: {
                    position: "RightBottom",
                    size: { width: 320, height: 420 },
                    icon: "iconJiesheng",
                    title: "任务信息",
                },
                data: {},
                init: (custom) => {
                    const el = custom?.element as HTMLElement | undefined;
                    if (!el) {
                        return;
                    }
                    this.panel = mountTaskPanel(el, buildPanelHost(deps));
                },
            });
        } catch (e) {
            showMessage("结绳：侧栏面板注册失败 —— " + (e as Error).message, 6000, "error");
        }
    }

    /** 全屏 Tab：视图层的画布。Dock 侧栏放不下看板的横排多列与日历的 7 列网格。 */
    private setupTab(deps: HostDeps): void {
        this.addTab({
            type: TAB_TYPE,
            init: (custom) => {
                const el = custom?.element as HTMLElement | undefined;
                if (!el) {
                    return;
                }
                this.tab = mountTab(el, buildViewHost(deps));
            },
        });
    }

    /* ── 共享能力 ────────────────────────────────────────────────────────── */

    private async notebookMap(): Promise<Record<string, string>> {
        const now = Date.now();
        if (this.notebookCache && now - this.notebookCache.at < 30_000) {
            return this.notebookCache.map;
        }
        try {
            const res = await callKernel<{ notebooks?: { id: string; name: string }[] }>(
                "/api/notebook/lsNotebooks", {},
            );
            const map = Object.fromEntries((res?.notebooks ?? []).map((n) => [n.id, n.name]));
            this.notebookCache = { at: now, map };
            return map;
        } catch {
            return this.notebookCache?.map ?? {};
        }
    }

    private async loadSettingsOnce(): Promise<void> {
        this.settings = await loadSettings();
    }

    private async toggleDone(id: string): Promise<void> {
        const r = await actions.toggleTaskDone(id);
        if (r.message) {
            showMessage(r.message, 4000, "error");
        }
    }

    private async afterCompleted(id: string): Promise<void> {
        try {
            await generateNextRepeat(id, actions.buildGenerateDeps());
        } catch (e) {
            showMessage("结绳：" + ((e as Error)?.message ?? "重复生成失败"), 4000, "error");
        }
    }

    private async createTask(title: string, due: string | null): Promise<string | null> {
        const r = await actions.createTaskDoc(title, due);
        if (!r.ok) {
            showMessage(r.message ?? "新建任务失败", 5000, "error");
            return null;
        }
        return r.id ?? null;
    }

    private async promoteToTask(id: string): Promise<void> {
        const r = await actions.promoteBlockToTask(id);
        if (!r.ok) {
            showMessage(r.message ?? "转为任务失败", 4000, "error");
            return;
        }
        if (r.toast) {
            showMessage(r.toast, 3000);
        }
        if (r.id) {
            this.taskIndex.remember(r.id); // 刚变成任务，别等下一次刷新
        }
    }

    private rawCaretBlockId(): string | null {
        try {
            return cursorBlockId(getActiveEditor(true) as unknown as ProtyleLike);
        } catch {
            return null;
        }
    }

    private openBlock(id: string): void {
        const w = window as unknown as { openFileByURL?: (u: string) => void };
        if (typeof w.openFileByURL === "function") {
            w.openFileByURL(`siyuan://blocks/${id}`);
            return;
        }
        showMessage("结绳：当前前端不支持跳转", 3000, "error");
    }

    private openDock(): void {
        try {
            // ⚠️ 这是程序化 click：它**不会**移动编辑器光标，
            //   所以不能拿「点击位置」去判断要不要解除面板的固定（见 ui/follow.ts）。
            const item = document.querySelector<HTMLElement>(`[data-type="${this.name}${DOCK_TYPE}"]`);
            item?.click();
        } catch {
            /* 面板没挂上就算了，不影响命令本身 */
        }
    }
}

