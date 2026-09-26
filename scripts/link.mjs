#!/usr/bin/env node
/**
 * 把构建产物 + 运行时文件拷进思源插件目录。
 *
 * 注意：**必须是真实目录，symlink 不被思源识别**（os.ReadDir 不跟随，M0 实测）。
 * 用法：pnpm build && node scripts/link.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = "siyuan-plugin-jiesheng";
const dest = join(homedir(), "some/workspace/data/plugins", NAME);
const root = new URL("..", import.meta.url).pathname;

if (!existsSync(join(root, "dist/index.js"))) {
    console.error("dist/index.js 不存在，先跑 pnpm build");
    process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const f of ["plugin.json", "icon.png", "README.md", "README.zh_CN.md"]) {
    cpSync(join(root, f), join(dest, f));
}
cpSync(join(root, "dist/index.js"), join(dest, "index.js"));
if (existsSync(join(root, "dist/kernel.js"))) {
    cpSync(join(root, "dist/kernel.js"), join(dest, "kernel.js"));
}
cpSync(join(root, "i18n"), join(dest, "i18n"), { recursive: true });

console.log("已同步到", dest);
