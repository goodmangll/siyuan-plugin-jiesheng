// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { countSelectedBlocks, cursorBlockIdFrom, taskBlockIdFromElement } from "../../src/api/dom";

/**
 * 这一层是 DOM 胶水，以前完全靠真机手测 —— 结果就漏掉了下面这个 bug。
 * 真机复现：光标在文档标题上，但 `.protyle-wysiwyg--select` 还残留着
 * **上一个任务的段落块**，于是快捷键把日期写给了那个旧任务。
 */
function buildDom(): HTMLElement {
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    // A：残留的「选中」块，光标并不在它里面
    const a = document.createElement("div");
    a.dataset.nodeId = "BLOCK_SELECTED";
    a.className = "protyle-wysiwyg--select";
    a.textContent = "旧任务";
    // B：光标真正所在的块
    const b = document.createElement("div");
    b.dataset.nodeId = "BLOCK_CARET";
    const span = document.createElement("span");
    span.textContent = "光标在这里";
    b.appendChild(span);
    root.append(a, b);
    document.body.appendChild(root);
    return b;
}

function putCaretIn(el: Element): void {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
}

beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
});

describe("D1 光标优先于残留的「选中」标记", () => {
    it("有实时光标时，取光标所在块 —— 而不是残留的 --select 块", () => {
        const b = buildDom();
        putCaretIn(b);
        expect(cursorBlockIdFrom(document)).toBe("BLOCK_CARET");
    });

    it("光标指向别的块时同理（真机 bug 就是这个：写到了旧任务上）", () => {
        const b = buildDom();
        putCaretIn(b);
        // 即便 --select 仍在、且它在 DOM 里排更前，也不能被它带偏
        expect(cursorBlockIdFrom(document)).not.toBe("BLOCK_SELECTED");
    });
});

describe("D2 没有光标时才回退到「选中」标记", () => {
    it("没有任何选区 → 用 --select（块标菜单那条路径依赖它）", () => {
        buildDom();
        window.getSelection()?.removeAllRanges();
        expect(cursorBlockIdFrom(document)).toBe("BLOCK_SELECTED");
    });

    it("什么都没有 → null，不抛", () => {
        expect(cursorBlockIdFrom(document)).toBeNull();
    });
});

describe("D3 向上找最近的 data-node-id", () => {
    it("光标在孙子节点里也能找到所属块", () => {
        const b = buildDom();
        const deep = document.createElement("em");
        b.firstElementChild!.appendChild(deep);
        putCaretIn(deep);
        expect(cursorBlockIdFrom(document)).toBe("BLOCK_CARET");
    });
});

describe("D4 嵌套任务取最近的一层（块标菜单用）", () => {
    it("子任务里的元素命中的是子任务本身", () => {
        const parent = document.createElement("div");
        parent.dataset.nodeId = "P";
        parent.dataset.subtype = "t";
        const child = document.createElement("div");
        child.dataset.nodeId = "C";
        child.dataset.subtype = "t";
        parent.appendChild(child);
        document.body.appendChild(parent);
        expect(taskBlockIdFromElement(child)).toBe("C");
    });
    it("不是任务 → null", () => {
        const p = document.createElement("p");
        document.body.appendChild(p);
        expect(taskBlockIdFromElement(p)).toBeNull();
    });
});

describe("D5 多块选中的识别（T18：要么全生效，要么明确提示）", () => {
    it("没有选中 → 0", () => {
        expect(countSelectedBlocks(document)).toBe(0);
    });
    it("选中一个 → 1", () => {
        buildDom();
        expect(countSelectedBlocks(document)).toBe(1);
    });
    it("选中两个 → 2", () => {
        const b = buildDom();
        b.classList.add("protyle-wysiwyg--select");
        expect(countSelectedBlocks(document)).toBe(2);
    });
});
