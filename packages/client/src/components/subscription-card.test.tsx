import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import { SubscriptionCard } from "./subscription-card";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const mocks = vi.hoisted(() => {
  const longCategoryLabel = "生产力平台和开发者基础设施";
  const shortCategoryLabel = "生产力";

  return {
    longCategoryLabel,
    shortCategoryLabel,
    config: {
      categories: [
        {
          id: "developer-tools",
          value: "developer-tools",
          labels: { "zh-CN": longCategoryLabel, "en-US": longCategoryLabel },
          color: "hsl(200 80% 50%)",
        },
        {
          id: "productivity",
          value: "productivity",
          labels: { "zh-CN": shortCategoryLabel, "en-US": shortCategoryLabel },
          color: "hsl(200 80% 50%)",
        },
      ],
      statuses: [],
      paymentMethods: [],
      currencies: [],
    },
  };
});

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: mocks.config,
    updateCategories: vi.fn(),
    updateStatuses: vi.fn(),
    updatePaymentMethods: vi.fn(),
    updateCurrencies: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { notificationReminderDays: 5 },
  }),
}));

const baseSubscription: Subscription = {
  id: "sub-1",
  name: "dmit",
  logo: undefined,
  price: 159,
  currency: "USD",
  billingCycle: "monthly",
  customDays: undefined,
  category: "developer-tools",
  status: "active",
  paymentMethod: undefined,
  startDate: assertDateOnly("2026-05-15"),
  nextBillingDate: assertDateOnly("2026-06-15"),
  autoCalculateNextBillingDate: true,
  trialEndDate: undefined,
  website: undefined,
  notes: undefined,
  tags: [],
  reminderDays: 7,
  repeatReminderEnabled: false,
  repeatReminderInterval: "1h",
  repeatReminderWindow: "72h",
};

function createSubscription(overrides: SubscriptionOverrides = {}): Subscription {
  if (overrides.billingCycle === "custom") {
    return {
      ...baseSubscription,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
    };
  }

  return {
    ...baseSubscription,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
  };
}

function renderSubscriptionCard(overrides: SubscriptionOverrides = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SubscriptionCard
        subscription={createSubscription(overrides)}
        timeZone="Asia/Shanghai"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("SubscriptionCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders subscription logos on the shared neutral logo tile", () => {
    renderSubscriptionCard({ logo: "https://example.com/apple-tv.svg", name: "Apple TV" });

    const logo = screen.getByAltText("Apple TV");
    const logoTile = logo.closest("div");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile).not.toHaveClass("bg-gradient-to-br");
    expect(logoTile?.getAttribute("style")).not.toContain("accent");
  });

  it("uses the same neutral logo path for white transparent logos", () => {
    renderSubscriptionCard({ logo: "https://example.com/white-logo.svg", name: "ngrok" });

    const logo = screen.getByAltText("ngrok");
    const logoTile = logo.closest("div");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile?.getAttribute("style")).not.toContain("accent");
  });

  it("keeps the initials fallback inside the neutral logo tile", () => {
    renderSubscriptionCard({ name: "dmit", logo: undefined });

    const initials = screen.getByText("DM");
    const logoTile = initials.closest("div");

    expect(initials).toHaveClass("subscription-logo-fallback");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile).not.toHaveClass("bg-gradient-to-br");
  });

  it("lets the badge group use the full header width before wrapping", () => {
    renderSubscriptionCard();

    const categoryText = screen.getByText(mocks.longCategoryLabel);
    const categoryBadge = categoryText.closest("div");
    const badgeGroup = categoryBadge?.parentElement;
    const statusBadge = screen.getByText("活跃").closest("div");
    const subscriptionName = screen.getByText(baseSubscription.name);

    expect(badgeGroup).toHaveClass("col-span-full", "flex", "flex-wrap", "items-center", "gap-2");
    expect(badgeGroup).not.toHaveClass("overflow-hidden");
    expect(subscriptionName).toHaveAttribute("data-slot", "truncated-tooltip-text");
    expect(subscriptionName).not.toHaveAttribute("title");
    expect(categoryBadge).not.toHaveAttribute("title");
    expect(categoryBadge).toHaveClass(
      "max-w-full",
      "shrink-0",
      "overflow-hidden",
      "whitespace-nowrap",
    );
    expect(categoryBadge).not.toHaveClass("min-w-[3.5rem]", "max-w-[7.5rem]");
    expect(categoryText).toHaveClass("block", "max-w-full", "truncate");
    expect(statusBadge).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("shows short category labels inside the badge", () => {
    renderSubscriptionCard({ category: "productivity" });

    const categoryText = screen.getByText(mocks.shortCategoryLabel);
    const categoryBadge = categoryText.closest("div");

    expect(categoryBadge).toHaveTextContent(mocks.shortCategoryLabel);
    expect(categoryBadge).not.toHaveAttribute("title");
    expect(categoryBadge).not.toHaveClass("min-w-[3.5rem]", "max-w-[7.5rem]");
    expect(categoryText).toHaveAttribute("data-slot", "truncated-tooltip-text");
    expect(categoryText).toHaveClass("block", "max-w-full", "truncate");
  });

  it("always exposes the overflow menu trigger", () => {
    renderSubscriptionCard();

    const menuButton = screen.getByRole("button", { name: "更多操作" });

    expect(menuButton).toHaveClass("h-8", "w-8", "shrink-0");
    expect(menuButton).not.toHaveClass("opacity-0");
    expect(menuButton.getAttribute("class")).not.toContain("group-hover:opacity-100");
  });

  it("renders overdue active subscriptions with the expired status treatment", () => {
    renderSubscriptionCard({ status: "active", nextBillingDate: assertDateOnly("2026-05-15") });

    const statusBadge = screen.getByText("已过期").closest("div");
    const expiredDateText = screen.getByText("已过期 3 天");
    const card = statusBadge?.closest(".group");

    expect(statusBadge).toHaveClass("bg-destructive/10", "text-destructive", "border-destructive/20");
    expect(expiredDateText.closest("div")).toHaveClass("text-destructive");
    expect(card).toHaveClass("border-destructive/40");
    expect(screen.queryByText("到期: 2026/5/15")).not.toBeInTheDocument();
  });

  it("renders inherited reminder days with the current global setting", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionCard
          subscription={createSubscription({ reminderDays: -1 })}
          viewMode="list"
          timeZone="Asia/Shanghai"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("默认提醒：提前 5 天")).toBeInTheDocument();
  });
});
