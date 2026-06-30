// 上传图标管理 hook 测试保护删除状态机：引用阻止时不能乐观移除，也不能替用户级联清空订阅 Logo。
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { UploadedAsset, UploadedAssetsPage, UploadKind } from "@/lib/api/schemas/media";
import { uploadedAssetsQueryKeys } from "@/hooks/use-uploaded-assets";
import { useUploadedAssetsManager } from "./use-uploaded-assets-manager";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/asset-service", () => ({
  assetService: {
    list: mocks.list,
    delete: mocks.delete,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "settings.uploadedIconsDeleteBlockedBySubscriptions") {
        return `仍被 ${String(params?.["count"])} 个订阅使用，请先到订阅里换掉 Logo。`;
      }
      if (key === "settings.uploadedIconsDeleteBlockedByPaymentMethods") {
        return `仍被 ${String(params?.["count"])} 个支付方式使用，请先到支付方式管理里换掉图标。`;
      }
      if (key === "settings.uploadedIconsDeleteBlockedByBoth") {
        return `仍被 ${String(params?.["subscriptionCount"])} 个订阅和 ${String(params?.["paymentMethodCount"])} 个支付方式使用，请先分别换掉 Logo 和支付方式图标。`;
      }
      if (key === "settings.uploadedIconsDeleteSuccessDescription") {
        return `已删除 ${String(params?.["name"])}。`;
      }
      const messages: Record<string, string> = {
        "settings.uploadedIconsDeleteFailed": "删除失败",
        "settings.uploadedIconsDeleteFailedDescription": "无法删除上传图标。",
        "settings.uploadedIconsDeleteSuccess": "上传图标已删除",
        "settings.uploadedIconsUnnamedAsset": "未命名资产",
      };
      return messages[key] ?? key;
    },
  }),
}));

function asset(overrides: Partial<UploadedAsset> = {}): UploadedAsset {
  return {
    id: "asset_logo",
    url: "/api/app/assets/asset_logo",
    kind: "logo",
    originalName: "logo.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    created: "2026-06-01T00:00:00.000Z",
    updated: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: UploadedAsset[], overrides: Partial<UploadedAssetsPage> = {}): UploadedAssetsPage {
  return {
    items,
    page: 1,
    totalPages: 1,
    ...overrides,
  };
}

function mockListOnce(logoPage: UploadedAssetsPage, iconPage: UploadedAssetsPage) {
  mocks.list.mockImplementation(async (kind: UploadKind) => (kind === "logo" ? logoPage : iconPage));
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient, invalidateSpy };
}

describe("useUploadedAssetsManager", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.delete.mockReset();
    mocks.toast.mockReset();
    mockListOnce(page([]), page([]));
  });

  it("loads logo and icon assets when settings opens", async () => {
    const logoAsset = asset({ id: "asset_logo", kind: "logo" });
    const iconAsset = asset({ id: "asset_icon", kind: "icon", originalName: "icon.svg" });
    mockListOnce(page([logoAsset]), page([iconAsset]));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.logo.assets.map((item) => item.id)).toEqual(["asset_logo"]);
      expect(result.current.icon.assets.map((item) => item.id)).toEqual(["asset_icon"]);
    });
    expect(mocks.list).toHaveBeenCalledWith("logo", 1);
    expect(mocks.list).toHaveBeenCalledWith("icon", 1);
  });

  it("updates the icon manager when the shared uploaded icon query is invalidated", async () => {
    const paymentIcon = asset({ id: "asset_payment", kind: "icon", originalName: "payment.svg" });
    mocks.list.mockImplementation(async (kind: UploadKind) => {
      if (kind === "logo") return page([]);
      return mocks.list.mock.calls.filter(([calledKind]) => calledKind === "icon").length > 1
        ? page([paymentIcon])
        : page([]);
    });
    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.icon.hasLoaded).toBe(true));
    expect(result.current.icon.assets).toEqual([]);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: uploadedAssetsQueryKeys.byKind("icon") });
    });

    await waitFor(() => expect(result.current.icon.assets.map((item) => item.id)).toEqual(["asset_payment"]));
  });

  it("removes a deleted asset from the matching kind list", async () => {
    const logoAsset = asset();
    mocks.list.mockImplementation(async (kind: UploadKind) => {
      if (kind === "icon") return page([]);
      return mocks.delete.mock.calls.length > 0 ? page([]) : page([logoAsset]);
    });
    mocks.delete.mockResolvedValue(undefined);
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.logo.assets).toHaveLength(1));
    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteAsset(logoAsset);
    });

    expect(deleted).toBe(true);
    expect(mocks.delete).toHaveBeenCalledWith("asset_logo");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: uploadedAssetsQueryKeys.byKind("logo") });
    await waitFor(() => expect(result.current.logo.assets).toEqual([]));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "上传图标已删除",
    }));
  });

  it("keeps subscription-referenced assets in place and points users to subscriptions", async () => {
    const logoAsset = asset();
    mockListOnce(page([logoAsset]), page([]));
    mocks.delete.mockRejectedValue(new ApiError(
      "in use",
      409,
      { usageCount: 2, subscriptionLogoCount: 2, paymentMethodIconCount: 0 },
      "ASSET_IN_USE",
    ));
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.logo.assets).toHaveLength(1));
    let deleted = true;
    await act(async () => {
      deleted = await result.current.deleteAsset(logoAsset);
    });

    expect(deleted).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: uploadedAssetsQueryKeys.byKind("logo") });
    expect(result.current.logo.assets.map((item) => item.id)).toEqual(["asset_logo"]);
    expect(result.current.deleteError).toEqual({
      assetId: "asset_logo",
      message: "仍被 2 个订阅使用，请先到订阅里换掉 Logo。",
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除失败",
      variant: "destructive",
    }));
  });

  it("keeps payment-method-referenced assets in place and points users to payment methods", async () => {
    const paymentIcon = asset({ kind: "icon", originalName: "card.svg" });
    mockListOnce(page([]), page([paymentIcon]));
    mocks.delete.mockRejectedValue(new ApiError(
      "in use",
      409,
      { usageCount: 1, subscriptionLogoCount: 0, paymentMethodIconCount: 1 },
      "ASSET_IN_USE",
    ));
    const { Wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.icon.assets).toHaveLength(1));
    let deleted = true;
    await act(async () => {
      deleted = await result.current.deleteAsset(paymentIcon);
    });

    expect(deleted).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: uploadedAssetsQueryKeys.byKind("icon") });
    expect(result.current.icon.assets.map((item) => item.id)).toEqual(["asset_logo"]);
    expect(result.current.deleteError).toEqual({
      assetId: "asset_logo",
      message: "仍被 1 个支付方式使用，请先到支付方式管理里换掉图标。",
    });
  });

  it("keeps mixed-referenced assets in place and names both reference sources", async () => {
    const logoAsset = asset();
    mockListOnce(page([logoAsset]), page([]));
    mocks.delete.mockRejectedValue(new ApiError(
      "in use",
      409,
      { usageCount: 3, subscriptionLogoCount: 2, paymentMethodIconCount: 1 },
      "ASSET_IN_USE",
    ));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUploadedAssetsManager(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.logo.assets).toHaveLength(1));
    await act(async () => {
      await result.current.deleteAsset(logoAsset);
    });

    expect(result.current.deleteError).toEqual({
      assetId: "asset_logo",
      message: "仍被 2 个订阅和 1 个支付方式使用，请先分别换掉 Logo 和支付方式图标。",
    });
  });
});
