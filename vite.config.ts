import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    // ⚠️ 必须定义：React 用 process.env.NODE_ENV 选 dev/prod 构建，
    //    而浏览器里没有 process —— 不定义的话插件在 import 阶段就抛
    //    ReferenceError: process is not defined，表现为「插件静默不加载」。
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
        lib: {
            entry: "src/plugin.ts",
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            // 思源运行时注入这个模块；React 则打进包里（插件包必须自包含）
            external: ["siyuan"],
            output: { exports: "named" },
        },
        outDir: "dist",
        emptyOutDir: true,
        minify: "esbuild",
        target: "es2020",
    },
});
