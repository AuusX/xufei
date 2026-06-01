import { spawnSync } from "node:child_process";

// Cloudflare Workers Builds 注入 WORKERS_CI；本地默认仍走 Docker/Go/PocketBase 构建链。
const target = process.env.WORKERS_CI === "1" ? "build:cloudflare" : "build:docker";
const result = spawnSync("pnpm", ["run", target], { stdio: "inherit", shell: process.platform === "win32" });

process.exit(result.status ?? 1);
