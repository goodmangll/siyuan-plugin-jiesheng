#!/usr/bin/env node
/**
 * 把构建产物 + 运行时文件拷进思源插件目录。
 *
 * 注意：**必须是真实目录，symlink 不被思源识别**（os.ReadDir 不跟随，M0 实测）。
 * 用法：pnpm build && node scripts/link.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = "siyuan-plugin-jiesheng";
const root = new URL("..", import.meta.url).pathname;

/**
 * 思源工作区在哪，**不写在仓库里**。
 *
 * 以前这里硬编码了某个本机目录 —— 既把开发者的目录结构
 * 带进了公开仓库，也意味着别人 clone 下来根本跑不了。改成分两步找：
 *
 *   1. 环境变量 `SIYUAN_WORKSPACE`
 *   2. `.local/config.json` 里的 `siyuanWorkspace`
 *      （`.local/` 已被 git 忽略 —— 正是放这种本机专属配置的地方）
 *
 * 两处都没有就退回到“常见位置探测”，再不行就报错说清楚要配什么。
 */
function findWorkspace() {
    if (process.env.SIYUAN_WORKSPACE) {
        return process.env.SIYUAN_WORKSPACE;
    }
    const cfg = join(root, ".local", "config.json");
    if (existsSync(cfg)) {
        try {
            const ws = JSON.parse(readFileSync(cfg, "utf8"))?.siyuanWorkspace;
            if (ws) {
                return ws;
            }
        } catch (e) {
            console.error(`.local/config.json 读不了：${e.message}`);
            process.exit(1);
        }
    }
    // 常见约定：思源把工作区放在 <工作区目录>/SiYuan/，插件在其 data/plugins 下
    for (const c of ["SiYuan", "siyuan", "Documents/SiYuan"]) {
        const p = join(homedir(), c, "data", "plugins");
        if (existsSync(p)) {
            return join(homedir(), c);
        }
    }
    console.error(
        "找不到思源工作区。两种配法（任选一）：\n" +
            "  · 环境变量：SIYUAN_WORKSPACE=/path/to/SiYuan pnpm build\n" +
            '  · .local/config.json：{"siyuanWorkspace": "/path/to/SiYuan"}\n' +
            "（.local/ 已被 git 忽略，适合放本机专属路径）",
    );
    process.exit(1);
}

const dest = join(findWorkspace(), "data", "plugins", NAME);

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
