/**
 * 思源插件入口。
 *
 * 这一层只做「接线」：把 commands / api / ui 三块拼到思源的 Plugin 生命周期上。
 * 所有可测的逻辑都在下层，这里不做判断。
 */
import { Plugin, fetchSyncPost, getActiveEditor, showMessage } from "siyuan";
import {
    getBlockKramdown, getTaskAttrs, resolveTaskBlock, setBlockAttrs, setTransport, updateBlockMarkdown,
} from "./api/blocks";
import { cursorBlockId, type ProtyleLike } from "./api/dom";
import type { KernelResponse } from "./api/blocks";
import { COMMANDS, type TaskCommandDeps } from "./commands";
import { DockPanel } from "./ui/dockPanel";

const DOCK_TYPE = "taskFlowDock";
const NOT_READY = "任务流：插件仍在初始化，请稍后再试";

const ICON = '<symbol id="iconTaskFlow" viewBox="0 0 32 32">'
    + '<path d="M7 5h18a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 5v2h14v-2H9zm0 5v2h10v-2H9zm0 5v2h7v-2H9z"/>'
    + "</symbol>";

export default class TaskFlow extends Plugin {
    private panel: DockPanel | null = null;
    private transportReady = false;

    async onload(): Promise<void> {
        // transport：思源的 fetchPost 返回的是 data 本身，不是 {code,msg,data} 信封（M0 实测），
        // 这里把它重新包成 api 层期望的形状。
        // ⚠️ 必须用 fetchSyncPost：`fetchPost(url, data)` 在**不带回调**时 resolve 的是 undefined
        //    （真机踩到的坑，M0 探针里也出现过同样现象）。
        //    fetchSyncPost 才返回 {code, msg, data} 信封。
        const post = fetchSyncPost as unknown as (url: string, data?: unknown) => Promise<KernelResponse>;
        setTransport(async (url, data) => await post(url, data ?? {}));
        this.transportReady = true;

        this.addIcons(ICON);

        const deps = this.buildDeps();
        for (const cmd of COMMANDS) {
            this.addCommand({
                langKey: cmd.langKey,
                langText: cmd.langText,
                hotkeys: cmd.hotkeys,
                execute: () => {
                    void cmd.run(deps).catch((e) => {
                        // 命令出错不能让编辑器崩：提示一下就行
                        showMessage("任务流：" + ((e as Error).message || "执行失败"), 5000, "error");
                    });
                },
            });
        }

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
                    this.panel = new DockPanel({
                        currentBlockId: () => this.currentBlockId(),
                        readAttrs: (id) => getTaskAttrs(id),
                    });
                    this.panel.mount(el);
                },
            });
        } catch (e) {
            showMessage("任务流：侧栏面板注册失败 —— " + (e as Error).message, 6000, "error");
        }
    }

    onunload(): void {
        this.panel = null;
    }

    private buildDeps(): TaskCommandDeps {
        return {
            now: () => new Date(),
            activeTaskBlockId: async () => {
                const cur = this.currentBlockId();
                return cur ? await resolveTaskBlock(cur) : null;
            },
            readAttrs: (id) => getTaskAttrs(id),
            writeAttrs: (id, patch) => {
                if (!this.transportReady) {
                    return Promise.reject(new Error(NOT_READY));
                }
                return setBlockAttrs(id, patch);
            },
            readKramdown: (id) => getBlockKramdown(id),
            writeKramdown: (id, md) => updateBlockMarkdown(id, md),
            openPanel: (id) => {
                void this.panel?.refresh(id);
                this.openDock();
            },
            toast: (m) => showMessage(m, 3000),
        };
    }

    /** 当前编辑器里光标所在的块 id（未归一化） */
    private currentBlockId(): string | null {
        try {
            return cursorBlockId(getActiveEditor(true) as unknown as ProtyleLike);
        } catch {
            return null;
        }
    }

    /** 把右侧栏的「任务信息」面板展开出来 */
    private openDock(): void {
        try {
            const item = document.querySelector<HTMLElement>(`[data-type="${this.name}${DOCK_TYPE}"]`);
            item?.click();
        } catch {
            /* 面板没挂上就算了，不影响命令本身 */
        }
    }
}
