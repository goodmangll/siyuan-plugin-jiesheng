import { defineConfig } from "vite";

export default defineConfig({
    build: {
        lib: {
            entry: "src/plugin.ts",
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            // 思源在运行时注入这两个模块
            external: ["siyuan"],
            output: { exports: "named" },
        },
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        target: "es2020",
    },
});
