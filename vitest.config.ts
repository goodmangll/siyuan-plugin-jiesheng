import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // .tsx 也给跑：面板是 React 组件，之前的缺口就是「面板全靠手测」
        include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
        // 默认 node；需要 DOM 的文件在首行加 `// @vitest-environment happy-dom`
        environment: "node",
    },
});
