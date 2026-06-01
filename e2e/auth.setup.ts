import { expect, test as setup } from "@playwright/test";
import {
  adminEmail,
  adminPassword,
  adminStorageState,
  expectRenewletSetupPage,
  isAuthWithPasswordResponse,
} from "./support/auth";
import { expectLabelControlGap } from "./support/layout";

setup("install admin through Renewlet setup UI", async ({ page }) => {
  await page.goto("/setup");
  await expectRenewletSetupPage(page);
  await expectLabelControlGap(page.getByLabel("名称", { exact: true }), "setup name");
  await expectLabelControlGap(page.getByLabel("邮箱", { exact: true }), "setup email");
  await expectLabelControlGap(page.getByLabel("密码", { exact: true }), "setup password");

  await page.getByLabel("名称", { exact: true }).fill("Admin");
  await page.getByLabel("邮箱", { exact: true }).fill(adminEmail);
  await page.getByLabel("密码", { exact: true }).fill("12");
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page.getByText("密码至少需要 8 位")).toBeVisible();

  await page.getByLabel("密码", { exact: true }).fill(adminPassword);
  // 响应等待比只等 URL 更能证明后端完成创建，避免随后登录时撞上初始化竞态。
  const setupResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/app/setup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建管理员" }).click();
  const setupResponse = await setupResponsePromise;
  expect(setupResponse.ok(), await setupResponse.text()).toBe(true);
  await expect(page).toHaveURL(/\/login$/);

  await expectLabelControlGap(page.getByLabel("邮箱", { exact: true }), "login email");
  await expectLabelControlGap(page.getByLabel("密码", { exact: true }), "login password");
  await page.getByLabel("邮箱", { exact: true }).fill(adminEmail);
  await page.getByLabel("密码", { exact: true }).fill(adminPassword);
  // storage state 只有在 auth-with-password 返回成功后才可信；否则会把半登录状态写给业务项目。
  const loginResponsePromise = page.waitForResponse((response) => isAuthWithPasswordResponse(response));
  await page.getByRole("button", { name: "登录" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok(), await loginResponse.text()).toBe(true);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("月度支出")).toBeVisible();

  await page.context().storageState({ path: adminStorageState });
});
