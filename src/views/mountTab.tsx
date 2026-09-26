/** 把视图层的 React 根挂到 Tab 容器上。 */
import { createRoot, type Root } from "react-dom/client";
import { TabApp } from "./TabApp";
import type { ViewHost, ViewId } from "./host";

export interface TabHandle {
    unmount(): void;
}

export function mountTab(el: HTMLElement, host: ViewHost, initialView?: ViewId): TabHandle {
    el.classList.add("jie-tab-root");
    el.style.height = "100%";
    const root: Root = createRoot(el);
    root.render(<TabApp host={host} initialView={initialView} />);
    return {
        unmount: () => root.unmount(),
    };
}
