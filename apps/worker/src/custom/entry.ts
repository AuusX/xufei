/**
 * 自定义 Worker 入口（wrapper 适配器）。
 *
 * `wrangler.jsonc` 的 `main` 指向这里，该字段由 `Sync Renewlet Upstream` 保留（见 docs/CUSTOMIZATION.md）。
 * 命中 `/api/custom/*` 走自定义路由；其余 fetch 与全部 scheduled(Cron) 原样委托上游 worker。
 * 上游 `index.ts` 仍是它自己的默认导出，这里只是包一层，不修改任何上游文件。
 */
import upstreamWorker from "../index";
import type { Env } from "../types";
import { carpoolApp } from "./carpool/routes";

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/custom/")) {
      return carpoolApp.fetch(request, env, ctx);
    }
    if (!upstreamWorker.fetch) {
      throw new Error("Upstream Renewlet worker is missing its fetch handler");
    }
    return upstreamWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    // Cron 完全交给上游（自动续订 / 通知 / 云备份）；拼车目前没有独立定时任务。
    await upstreamWorker.scheduled?.(controller, env, ctx);
  },
};

export default worker;
