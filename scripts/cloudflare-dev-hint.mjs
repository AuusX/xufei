#!/usr/bin/env node
import { networkInterfaces } from "node:os";

/**
 * Cloudflare 本地 Cron 提示。
 *
 * 触发时机：`pnpm dev:cloudflare` 在 wrangler dev 前打印；不写文件、不访问网络。
 * 业务意图：Wrangler 默认提示的 scheduled URL 不适合 Workers Static Assets，Renewlet 固定提示 `/__scheduled`。
 */
const devPort = 8787;
const localUrl = `http://localhost:${devPort}`;
const listenUrl = `http://0.0.0.0:${devPort}`;
const lanUrls = localLanUrls(devPort);
const scheduledCommand = `curl "${localUrl}/__scheduled?cron=*+*+*+*+*"`;
const lanLine = lanUrls.length > 0 ? lanUrls.join(", ") : `http://<this-machine-LAN-IP>:${devPort}`;

// Wrangler 的默认 /cdn-cgi scheduled 提示会误导 Workers Static Assets 项目；Renewlet 本地固定走 --test-scheduled 注入的 /__scheduled。
console.log([
  "",
  "Renewlet Cloudflare local dev",
  `  Worker: ${localUrl}`,
  `  Listen: ${listenUrl}`,
  `  LAN: ${lanLine}`,
  "  HTTP LAN: use http://<LAN-IP>:8787; local dev headers keep static assets on HTTP.",
  "  If Network shows https://<LAN-IP>:8787/assets/..., rerun `pnpm dev:cloudflare` so dist _headers is prepared.",
  `  Manual Cron: ${scheduledCommand}`,
  "  Expected response: Ran scheduled event",
  "  Do not use /cdn-cgi/handler/scheduled here; Workers Static Assets may return a bare exception.",
  "",
].join("\n"));

function localLanUrls(port) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  return Array.from(new Set(urls)).sort();
}
