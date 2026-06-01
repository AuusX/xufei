import { expect, type Page, type Response } from "@playwright/test";

export const adminEmail = "admin-e2e@example.com";
export const adminPassword = "password123";
export const adminStorageState = "e2e/.auth/admin.json";

export function isAuthWithPasswordResponse(response: Response): boolean {
  return response.url().includes("/api/collections/users/auth-with-password") &&
    response.request().method() === "POST";
}

export async function expectRenewletSetupPage(page: Page) {
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "初始化 Renewlet" })).toBeVisible();
  // PocketBase 空库默认 installer 曾经会弹到 43190/_/#/pbinstall；这里守住
  // Renewlet /setup 是唯一首屏入口，避免 headed E2E 看见无关后端管理页。
  await expect(page.getByText("Setup your PocketBase instance")).toHaveCount(0);
  await expect(page.getByText("Create your first superuser account")).toHaveCount(0);
}
