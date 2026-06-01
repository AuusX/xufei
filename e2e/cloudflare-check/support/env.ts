/// <reference types="node" />

export const cloudflareAuthStatePath = "test-results/cloudflare-check/.auth/admin.json";

export type CloudflareCheckEnv = {
  baseURL: string;
  credentials: { email: string; password: string } | null;
  writeScope: "temporary-write-delete" | "readonly";
};

function normalizeBaseURL(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error("Cloudflare 巡检需要设置 RENEWLET_E2E_BASE_URL。");
  }
  return new URL(value).toString().replace(/\/$/, "");
}

export function getCloudflareCheckEnv(): CloudflareCheckEnv {
  const email = process.env.RENEWLET_E2E_EMAIL?.trim() ?? "";
  const password = process.env.RENEWLET_E2E_PASSWORD?.trim() ?? "";
  const rawWriteScope = process.env.RENEWLET_E2E_WRITE_SCOPE?.trim();
  const writeScope = rawWriteScope === "readonly" ? "readonly" : "temporary-write-delete";

  return {
    baseURL: normalizeBaseURL(process.env.RENEWLET_E2E_BASE_URL),
    credentials: email && password ? { email, password } : null,
    writeScope,
  };
}

export function requireCloudflareCredentials(): { email: string; password: string } {
  const { credentials } = getCloudflareCheckEnv();
  if (!credentials) {
    throw new Error("认证巡检需要设置 RENEWLET_E2E_EMAIL 和 RENEWLET_E2E_PASSWORD。");
  }
  return credentials;
}

export function temporaryWritesEnabled(): boolean {
  return getCloudflareCheckEnv().writeScope === "temporary-write-delete";
}
