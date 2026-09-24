/** 把 React 面板挂到一个 DOM 元素上（Dock 容器）。 */
import { createRoot, type Root } from "react-dom/client";
import { TaskPanel, type TaskPanelHost } from "./TaskPanel";

export interface TaskPanelHandle {
    /** 重新读一次当前光标所在任务（光标移动 / 命令触发时调用） */
    refresh(): void;
    unmount(): void;
}

export function mountTaskPanel(el: HTMLElement, host: TaskPanelHost): TaskPanelHandle {
    let trigger: (() => void) | null = null;
    const root: Root = createRoot(el);
    root.render(<TaskPanel host={host} onReady={(fn) => { trigger = fn; }} />);
    return {
        refresh: () => trigger?.(),
        unmount: () => root.unmount(),
    };
}
