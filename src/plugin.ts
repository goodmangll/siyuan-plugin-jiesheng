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
import { cursorBlockId, taskBlockIdFromElement, type ProtyleLike } from "./api/dom";
import { callKernel, setTransport, type KernelResponse } from "./api/blocks";
import { COMMANDS } from "./commands";
import { DEFAULT_SETTINGS, type TaskFlowSettings } from "./settings";
import { loadSettings, saveSettings } from "./api/settings";
import { toDateStr } from "./model/date";
import { createFollowScheduler, selectionIsInEditor } from "./ui/follow";
import { mountTab, type TabHandle } from "./views/mountTab";
import { mountTaskPanel, type TaskPanelHandle } from "./ui/mountPanel";
import { openSettingsDialog } from "./ui/settingsDialog";
import { resolveTaskBlock } from "./api/blocks";
import { buildBlockMenuItems } from "./ui/blockMenu";
import { generateNextRepeat } from "./generate";
import * as actions from "./plugin/actions";
import { createSession } from "./plugin/session";
import { createReminderDaemon, notifyDesktop } from "./plugin/reminder";
import {
    buildBlockMenuDeps, buildCommandDeps, buildPanelHost, buildViewHost, type HostDeps,
} from "./plugin/hosts";

const TAB_TYPE = "taskFlowTab";
const DOCK_TYPE = "taskFlowDock";

const ICON = '<symbol id="iconTaskFlow" viewBox="0 0 32 32">'
    + '<path d="M16 3a13 13 0 1 0 0 26 13 13 0 0 0 0-26zm0 3a10 10 0 1 1 0 20 10 10 0 0 1 0-20z"/>'
    + '<circle cx="16" cy="16" r="3.4"/></symbol>';

export default class TaskFlow extends Plugin {
    private panel: TaskPanelHandle | null = null;
    private tab: TabHandle | null = null;

    private transportReady = false;
    private settings: TaskFlowSettings = { ...DEFAULT_SETTINGS };

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
        tabIcon: "iconTaskFlow",
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
                        showMessage("任务流：" + ((e as Error).message || "执行失败"), 5000, "error");
                    });
                },
            });
        }

        this.setupFollow();
        this.setupBlockMenu(deps);
        this.setupDock(deps);
        this.setupTab(deps);

        // 提醒：**前端这一份只在界面打开时跑**，且用自己的游标（见 plugin/reminder.ts）
        try {
            await this.loadSettingsOnce();
            this.daemon.start();
        } catch (e) {
            showMessage("任务流：提醒启动失败 —— " + (e as Error).message, 5000, "error");
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
                const { menu, blockElements } = event.detail;
                const taskId = taskBlockIdFromElement(blockElements?.[0] ?? null);
                const items = buildBlockMenuItems(taskId, buildBlockMenuDeps(deps));
                if (!items.length) {
                    return;
                }
                menu.addSeparator();
                menu.addItem({
                    icon: "iconTaskFlow",
                    label: "任务",
                    type: "submenu",
                    submenu: items.map((it) => ({
                        icon: it.icon,
                        label: it.label,
                        click: () => { void it.click(); },
                    })),
                });
            } catch {
                /* 挂菜单失败不能影响思源的块标菜单本身 */
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
                    icon: "iconTaskFlow",
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
            showMessage("任务流：侧栏面板注册失败 —— " + (e as Error).message, 6000, "error");
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
            showMessage("任务流：" + ((e as Error)?.message ?? "重复生成失败"), 4000, "error");
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
        showMessage("任务流：当前前端不支持跳转", 3000, "error");
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

