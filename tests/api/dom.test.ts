// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { blockHitFromElement, countSelectedBlocks, cursorBlockIdFrom, taskBlockIdFromElement } from "../../src/api/dom";

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

describe("D6 块标菜单：从点击的元素同步判断「点的是什么」", () => {
    function build(): { inTaskDoc: HTMLElement; plain: HTMLElement; listItem: HTMLElement } {
        const protyle = document.createElement("div");
        protyle.className = "protyle";
        protyle.dataset.nodeId = "DOC_1";
        const wys = document.createElement("div");
        wys.className = "protyle-wysiwyg";
        const p = document.createElement("div");
        p.dataset.nodeId = "PARA_1";
        p.dataset.type = "NodeParagraph";
        // 老模型的 - [ ] 列表项
        const li = document.createElement("div");
        li.dataset.nodeId = "LI_1";
        li.dataset.subtype = "t";
        p.appendChild(li);
        wys.appendChild(p);
        protyle.appendChild(wys);
        document.body.appendChild(protyle);

        const plainDoc = document.createElement("div");
        plainDoc.className = "protyle";
        plainDoc.dataset.nodeId = "DOC_2";
        const wys2 = document.createElement("div");
        wys2.className = "protyle-wysiwyg";
        const p2 = document.createElement("div");
        p2.dataset.nodeId = "PARA_2";
        wys2.appendChild(p2);
        plainDoc.appendChild(wys2);
        document.body.appendChild(plainDoc);

        return { inTaskDoc: p, plain: p2, listItem: li };
    }

    it("普通段落：给出块 id 与**所属文档 id**（新模型靠后者判任务）", () => {
        const { inTaskDoc } = build();
        const hit = blockHitFromElement(inTaskDoc);
        expect(hit.blockId).toBe("PARA_1");
        expect(hit.docId).toBe("DOC_1");
        expect(hit.isTaskItem).toBe(false);
    });

    it("- [ ] 列表项：isTaskItem 为真，块 id 取**最近**那层（嵌套也命中自己）", () => {
        const { listItem } = build();
        const hit = blockHitFromElement(listItem);
        expect(hit.blockId).toBe("LI_1");
        expect(hit.isTaskItem).toBe(true);
    });

    it("另一篇文档里的段落：docId 是它自己的文档，不会串到上一篇", () => {
        const { plain } = build();
        expect(blockHitFromElement(plain).docId).toBe("DOC_2");
    });

    it("null / 不在编辑器里 → 全空，不抛", () => {
        expect(blockHitFromElement(null)).toEqual({ blockId: null, docId: null, isTaskItem: false });
        const orphan = document.createElement("div");
        expect(blockHitFromElement(orphan).docId).toBeNull();
    });
});
