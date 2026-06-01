import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import { createSubscriptionFormState } from "@/types/subscription-form";
import { SubscriptionDialog } from "./subscription-dialog";

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: {
      categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
      statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
      paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
      currencies: [
        { id: "CNY", value: "CNY", labels: { "zh-CN": "人民币 (¥)", "en-US": "Chinese yuan (¥)" }, enabled: true },
        { id: "USD", value: "USD", labels: { "zh-CN": "美元 ($)", "en-US": "US dollar ($)" }, enabled: true },
      ],
    },
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { defaultCurrency: "USD" },
  }),
}));

vi.mock("@/components/subscription-form-fields", () => ({
  SubscriptionFormFields: ({ setFormData, errors }: {
    setFormData: (updater: ReturnType<typeof createSubscriptionFormState>) => void;
    errors?: Record<string, string> | undefined;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          setFormData(createSubscriptionFormState({
            name: "Aws",
            price: "15",
            currency: "USD",
            startDate: assertDateOnly("2026-05-14"),
            nextBillingDate: assertDateOnly("2026-06-14"),
            tags: [],
          }))
        }
      >
        填充有效订阅
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData(createSubscriptionFormState({
            name: "Free uptime check",
            price: "0",
            currency: "USD",
            startDate: assertDateOnly("2026-05-14"),
            nextBillingDate: assertDateOnly("2026-06-14"),
            tags: [],
          }))
        }
      >
        填充零元订阅
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData(createSubscriptionFormState({
            name: "Aws",
            price: "15",
            currency: "USD",
            startDate: assertDateOnly("2026-05-14"),
            nextBillingDate: assertDateOnly("2026-06-14"),
            website: "ftp://example.com",
          }))
        }
      >
        填充非法网站订阅
      </button>
      {errors?.["website"] ? <p role="alert">{errors["website"]}</p> : null}
    </>
  ),
}));

describe("SubscriptionDialog submit", () => {
  it("submits an empty tags array when the create form tags input is blank", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "填充有效订阅" }));
    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Aws",
      tags: [],
    }));
  });

  it("shows a field error for invalid website URLs", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "填充非法网站订阅" }));
    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(screen.getByRole("alert")).toHaveTextContent("网站地址必须使用 http:// 或 https://");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits zero-price subscriptions", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "填充零元订阅" }));
    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Free uptime check",
      price: 0,
    }));
  });
});
