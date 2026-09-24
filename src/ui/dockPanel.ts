/**
 * M1 的 Dock 面板 —— **只读**的「当前任务信息」。
 *
 * M2 会把它换成可编辑的表单（日期 / 优先级 / 提醒 / 重复 / 清单 / 标签 / 子任务）。
 * 现在先把它做出来的原因有两个：
 *   1. 让 `Alt+Shift+D` 这条命令有实际意义，而不是一句空提示；
 *   2. 把 M0 未验证的 `addDock` 面板渲染补上。
 */

import { ATTR, toMeta } from "../model/attrs";
import { describeRule } from "../model/repeat";
import { priorityLabel } from "../model/priority";

export interface DockPanelHost {
    /** 取当前任务块 id（未归一化） */
    currentBlockId(): string | null;
    /** 读合并后的属性 */
    readAttrs(id: string): Promise<Record<string, string>>;
}

const ROWS: { label: string; get: (m: ReturnType<typeof toMeta>) => string }[] = [
    { label: "截止", get: (m) => m.due ?? "—" },
    { label: "开始", get: (m) => m.start ?? "—" },
    { label: "优先级", get: (m) => priorityLabel(m.pri) },
    { label: "提醒", get: (m) => (m.remind.length ? m.remind.join("、") : "—") },
    { label: "重复", get: (m) => (m.repeat ? describeRule(m.repeat) : "—") },
    { label: "清单", get: (m) => m.list ?? "—" },
];

export class DockPanel {
    private el: HTMLElement | null = null;
    private focusBlockId: string | null = null;

    constructor(private host: DockPanelHost) {}

    mount(container: HTMLElement): void {
        this.el = container;
        container.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "task-flow-dock";
        wrap.style.cssText = "padding:10px 12px;font-size:13px;line-height:1.8;";

        const title = document.createElement("div");
        title.style.cssText = "font-weight:600;margin-bottom:6px;";
        title.textContent = "任务信息";
        wrap.appendChild(title);

        const body = document.createElement("div");
        body.id = "task-flow-dock-body";
        wrap.appendChild(body);

        const hint = document.createElement("div");
        hint.style.cssText = "margin-top:10px;opacity:.55;font-size:12px;";
        hint.textContent = "把光标放到任务上，按 Alt+Shift+D 刷新。编辑能力将在下个版本提供。";
        wrap.appendChild(hint);

        container.appendChild(wrap);
        void this.refresh();
    }

    /** 面板被点开或命令触发时刷新 */
    async refresh(blockId?: string | null): Promise<void> {
        if (!this.el) {
            return;
        }
        const body = this.el.querySelector<HTMLElement>("#task-flow-dock-body");
        if (!body) {
            return;
        }
        const id = blockId ?? this.host.currentBlockId();
        if (!id) {
            this.focusBlockId = null;
            body.textContent = "当前没有选中任务。";
            return;
        }
        this.focusBlockId = id;
        let attrs: Record<string, string> = {};
        try {
            attrs = await this.host.readAttrs(id);
        } catch {
            attrs = {};
        }
        const meta = toMeta(attrs);

        body.innerHTML = "";
        const idLine = document.createElement("div");
        idLine.style.cssText = "opacity:.55;font-size:11px;margin-bottom:4px;";
        idLine.textContent = id;
        body.appendChild(idLine);

        for (const row of ROWS) {
            const line = document.createElement("div");
            const k = document.createElement("span");
            k.style.cssText = "display:inline-block;width:4em;opacity:.6;";
            k.textContent = row.label;
            const v = document.createElement("span");
            v.textContent = row.get(meta);
            line.append(k, v);
            body.appendChild(line);
        }

    }

    /** 便于诊断：当前面板聚焦的块 */
    get focused(): string | null {
        return this.focusBlockId;
    }

    /** 只读面板用不到属性名常量，但保留引用以便 M2 扩展时不漏 */
    static readonly ATTRS = ATTR;
}
