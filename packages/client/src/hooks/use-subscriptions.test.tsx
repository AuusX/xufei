import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import type { ApiSubscription } from "@/lib/api/schemas/subscriptions";
import type {
  FixedCycleSubscription,
  RepeatReminderInterval,
  RepeatReminderWindow,
  Subscription,
} from "@/types/subscription";
import { useCreateSubscription, useUpdateSubscription } from "./use-subscriptions";

type FixedSubscriptionDraft = Omit<FixedCycleSubscription, "id">;

type SubscriptionWritePayload = {
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  billingCycle: FixedCycleSubscription["billingCycle"] | "custom";
  customDays: number | null;
  category: string;
  status: Subscription["status"];
  paymentMethod: string | null;
  startDate: string;
  nextBillingDate: string;
  autoCalculateNextBillingDate: boolean;
  trialEndDate: string | null;
  website: string | null;
  notes: string | null;
  tags: string[];
  reminderDays: number;
  repeatReminderEnabled: boolean;
  repeatReminderInterval: RepeatReminderInterval;
  repeatReminderWindow: RepeatReminderWindow;
};

type CreateSubscriptionPayload = SubscriptionWritePayload & { user: string };
type CreateSubscriptionMock = (payload: CreateSubscriptionPayload) => Promise<ApiSubscription>;
type UpdateSubscriptionMock = (id: string, payload: SubscriptionWritePayload) => Promise<ApiSubscription>;
type GetFullListMock = () => Promise<ApiSubscription[]>;
type SubscriptionCollectionMock = {
  create: CreateSubscriptionMock;
  update: UpdateSubscriptionMock;
  getFullList: GetFullListMock;
};

const mocks = vi.hoisted(() => ({
  collection: vi.fn<(name: "subscriptions") => SubscriptionCollectionMock>(),
  create: vi.fn<CreateSubscriptionMock>(),
  update: vi.fn<UpdateSubscriptionMock>(),
  getFullList: vi.fn<GetFullListMock>(),
  getCurrentUserId: vi.fn<() => string | null>(),
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: mocks.collection,
  },
  getCurrentUserId: mocks.getCurrentUserId,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function apiSubscriptionFromPayload(id: string, payload: SubscriptionWritePayload): ApiSubscription {
  return {
    id,
    name: payload.name,
    ...(payload.logo !== null ? { logo: payload.logo } : {}),
    price: payload.price,
    currency: payload.currency,
    billingCycle: payload.billingCycle,
    ...(payload.billingCycle === "custom" && payload.customDays !== null ? { customDays: payload.customDays } : {}),
    category: payload.category,
    status: payload.status,
    ...(payload.paymentMethod !== null ? { paymentMethod: payload.paymentMethod } : {}),
    startDate: payload.startDate,
    nextBillingDate: payload.nextBillingDate,
    autoCalculateNextBillingDate: payload.autoCalculateNextBillingDate,
    ...(payload.trialEndDate !== null ? { trialEndDate: payload.trialEndDate } : {}),
    ...(payload.website !== null ? { website: payload.website } : {}),
    ...(payload.notes !== null ? { notes: payload.notes } : {}),
    tags: payload.tags,
    reminderDays: payload.reminderDays,
    repeatReminderEnabled: payload.repeatReminderEnabled,
    repeatReminderInterval: payload.repeatReminderInterval,
    repeatReminderWindow: payload.repeatReminderWindow,
  };
}

function subscriptionDraft(overrides: Partial<FixedSubscriptionDraft> = {}): FixedSubscriptionDraft {
  return {
    name: "Aws",
    logo: "https://aws.amazon.com/favicon.ico",
    price: 15,
    currency: "USD",
    billingCycle: "monthly",
    customDays: undefined,
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-05-14"),
    nextBillingDate: assertDateOnly("2026-06-14"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    ...overrides,
  };
}

describe("use-subscriptions mutations", () => {
  beforeEach(() => {
    mocks.collection.mockReset();
    mocks.create.mockReset();
    mocks.update.mockReset();
    mocks.getFullList.mockReset();
    mocks.getCurrentUserId.mockReset();
    mocks.getCurrentUserId.mockReturnValue("user-1");
    mocks.collection.mockReturnValue({
      create: mocks.create,
      update: mocks.update,
      getFullList: mocks.getFullList,
    });
    mocks.create.mockImplementation(async (payload) => apiSubscriptionFromPayload("sub-1", payload));
    mocks.update.mockImplementation(async (_id, payload) => apiSubscriptionFromPayload("sub-1", payload));
  });

  it("keeps tags as an empty array when creating a subscription through PocketBase SDK", async () => {
    const { result } = renderHook(() => useCreateSubscription(), { wrapper: createWrapper() });
    const draft = subscriptionDraft({ tags: [] });

    await act(async () => {
      await result.current.mutateAsync(draft);
    });

    expect(mocks.collection).toHaveBeenCalledWith("subscriptions");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Aws",
      tags: [],
      repeatReminderEnabled: false,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
      user: "user-1",
    }));
  });

  it("keeps tags as an empty array when updating a subscription through PocketBase SDK", async () => {
    const { result } = renderHook(() => useUpdateSubscription(), { wrapper: createWrapper() });
    const subscription: Subscription = { id: "sub-1", ...subscriptionDraft({ tags: [] }) };

    await act(async () => {
      await result.current.mutateAsync(subscription);
    });

    expect(mocks.collection).toHaveBeenCalledWith("subscriptions");
    expect(mocks.update).toHaveBeenCalledWith("sub-1", expect.objectContaining({
      name: "Aws",
      tags: [],
      repeatReminderEnabled: false,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
    }));
  });
});
