import { defineConfig } from "vite";

/** 内核插件产物：goja 里跑，IIFE，不依赖 require */
export default defineConfig({
    build: {
        lib: {
            entry: "src/kernel.ts",
            formats: ["iife"],
            name: "JieshengKernel",
            fileName: () => "kernel.js",
        },
        outDir: "dist",
        emptyOutDir: false,
        minify: false,
        target: "es2018",
    },
});
