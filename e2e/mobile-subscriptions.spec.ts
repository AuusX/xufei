import { expect, test } from "@playwright/test";
import {
  createSubscription,
  expectTagInputPopoverLayout,
  expectTagSuggestionListScrollable,
  openSubscriptionEditDialog,
  subscriptionCard,
  uniqueE2EName,
} from "./support/subscriptions";
import {
  expectActionNearContainerBottom,
  expectOverlayLeavesTopScrim,
  getRequiredLocatorBoundingBox,
} from "./support/layout";

test("mobile subscription tag drawer and tag input layout", async ({ page }, testInfo) => {
  const plainName = uniqueE2EName(testInfo, "Mobile Plain");
  const taggedName = uniqueE2EName(testInfo, "Mobile Tagged");
  const tagName = uniqueE2EName(testInfo, "mobile-tag");
  const manyTags = [
    tagName,
    "云服务",
    "Issues",
    "Planning",
    "Testing",
    "QA",
    "E2E",
    "Browsers",
    "Automation",
    "Performance",
    "Billing",
    "Design",
    "Docs",
  ].join("、");

  await page.goto("/subscriptions");
  await expect(page.getByRole("heading", { name: "订阅列表" })).toBeVisible();

  await createSubscription(page, {
    name: plainName,
    price: "8",
    currencyLabel: "美元 ($)",
  });
  await createSubscription(page, {
    name: taggedName,
    price: "12",
    currencyLabel: "美元 ($)",
    tags: manyTags,
  });

  const mobileSortTagRow = page.getByTestId("mobile-sort-tag-row");
  await expect(mobileSortTagRow).toBeVisible();
  const mobileSortControl = mobileSortTagRow.getByRole("combobox", { name: "排序" });
  const mobileTagButton = mobileSortTagRow.getByRole("button", { name: "标签" });
  await expect(page.getByTestId("mobile-selected-tags")).toHaveCount(0);
  const [mobileSortBox, mobileTagBox] = await Promise.all([
    getRequiredLocatorBoundingBox(mobileSortControl, "mobile sort filter"),
    getRequiredLocatorBoundingBox(mobileTagButton, "mobile tag filter"),
  ]);
  expect(Math.abs(mobileSortBox.y - mobileTagBox.y), "mobile sort and tag controls should share a row").toBeLessThan(8);
  expect(mobileTagBox.x, "mobile tag button should sit to the right of sort").toBeGreaterThan(
    mobileSortBox.x + mobileSortBox.width - 1,
  );

  await mobileTagButton.click();
  const tagDrawer = page.getByRole("dialog", { name: "筛选标签" });
  await expect(tagDrawer).toBeVisible();
  await expectOverlayLeavesTopScrim(page, tagDrawer, "mobile tag filter drawer");
  await expectActionNearContainerBottom(
    tagDrawer,
    tagDrawer.getByRole("button", { name: "确定" }),
    "mobile tag filter drawer confirm",
  );
  await tagDrawer.getByPlaceholder("搜索标签...").fill(tagName);
  await tagDrawer.getByRole("button", { name: tagName }).click();
  await tagDrawer.getByRole("button", { name: "确定" }).click();
  await expect(tagDrawer).toBeHidden();
  await expect(page.getByTestId("mobile-selected-tags")).toBeVisible();
  await expect(subscriptionCard(page, taggedName)).toBeVisible();
  await expect(subscriptionCard(page, plainName)).toBeHidden();
  await expect(subscriptionCard(page, taggedName)).toBeInViewport();

  await mobileSortTagRow.getByRole("button", { name: "标签(1)" }).click();
  await expect(tagDrawer).toBeVisible();
  await tagDrawer.getByRole("button", { name: "清空标签" }).click();
  await expect(tagDrawer).toBeHidden();
  await expect(page.getByTestId("mobile-selected-tags")).toHaveCount(0);
  await expect(subscriptionCard(page, plainName)).toBeVisible();

  const plainEditDialog = await openSubscriptionEditDialog(page, plainName);
  await plainEditDialog.getByLabel("标签", { exact: true }).click();
  await expectTagSuggestionListScrollable(page);
  await page.keyboard.press("Escape");
  await plainEditDialog.getByRole("button", { name: "取消" }).click();
  await expect(plainEditDialog).toBeHidden();

  const editDialog = await openSubscriptionEditDialog(page, taggedName);
  const editTagInput = editDialog.getByLabel("标签", { exact: true });
  await editTagInput.fill("测试、研发、财务、运营、设计、增长");
  await editTagInput.click();
  await page.keyboard.type("layout");
  await expectTagInputPopoverLayout(page, editDialog);
  await page.keyboard.press("Escape");
  await editDialog.getByRole("button", { name: "取消" }).click();
  await expect(editDialog).toBeHidden();
});
