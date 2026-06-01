export type RenewletRuntime = "pocketbase" | "cloudflare";

const configuredRuntime: unknown = import.meta.env["VITE_RENEWLET_RUNTIME"];

// 默认仍是 PocketBase；只有 Cloudflare 构建显式注入变量时才切换运行面。
export const renewletRuntime: RenewletRuntime = configuredRuntime === "cloudflare" ? "cloudflare" : "pocketbase";
export const isCloudflareRuntime = renewletRuntime === "cloudflare";
