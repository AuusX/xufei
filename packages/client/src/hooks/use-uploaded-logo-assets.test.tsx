import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadedLogoAssets } from "./use-uploaded-logo-assets";

type AssetRecordFixture = {
  id: string;
  kind?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  created?: string;
  updated?: string;
  file?: string;
};

type AssetsListFixture = {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: AssetRecordFixture[];
};

type GetListOptions = {
  filter?: string;
  sort?: string;
  fields?: string;
};

type GetListMock = (page: number, perPage: number, options: GetListOptions) => Promise<AssetsListFixture>;

const mocks = vi.hoisted(() => ({
  collection: vi.fn<() => { getList: GetListMock }>(),
  filter: vi.fn<(template: string, params: Record<string, string>) => string>(),
  getList: vi.fn<GetListMock>(),
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: mocks.collection,
    filter: mocks.filter,
  },
}));

function listResult(overrides: Partial<AssetsListFixture> = {}): AssetsListFixture {
  return {
    page: 1,
    perPage: 48,
    totalItems: 1,
    totalPages: 1,
    items: [
      {
        id: "asset-1",
        kind: "logo",
        originalName: "netflix.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        created: "2026-05-16 10:00:00.000Z",
        updated: "2026-05-17 10:00:00.000Z",
        file: "private-file-name.png",
      },
    ],
    ...overrides,
  };
}

function StrictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useUploadedLogoAssets", () => {
  beforeEach(() => {
    mocks.collection.mockReset();
    mocks.filter.mockReset();
    mocks.getList.mockReset();
    mocks.collection.mockReturnValue({ getList: mocks.getList });
    mocks.filter.mockReturnValue("kind = 'logo'");
  });

  it("loads logo assets with a kind filter, newest-first sort, and trimmed fields", async () => {
    mocks.getList.mockResolvedValueOnce(listResult());
    const { result } = renderHook(() => useUploadedLogoAssets());

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(mocks.collection).toHaveBeenCalledWith("assets");
    expect(mocks.filter).toHaveBeenCalledWith("kind = {:kind}", { kind: "logo" });
    expect(mocks.getList).toHaveBeenCalledWith(1, 48, {
      filter: "kind = 'logo'",
      sort: "-updated",
      fields: "id,kind,originalName,mimeType,sizeBytes,created,updated",
    });
    expect(result.current.assets).toEqual([
      {
        id: "asset-1",
        url: "/api/app/assets/asset-1",
        kind: "logo",
        originalName: "netflix.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        created: "2026-05-16 10:00:00.000Z",
        updated: "2026-05-17 10:00:00.000Z",
      },
    ]);
    expect("file" in result.current.assets[0]!).toBe(false);
  });

  it("settles a successful load after the StrictMode setup-cleanup check", async () => {
    mocks.getList.mockResolvedValueOnce(listResult());
    const { result } = renderHook(() => useUploadedLogoAssets(), { wrapper: StrictWrapper });

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.assets.map((asset) => asset.id)).toEqual(["asset-1"]);
  });

  it("appends later pages while avoiding duplicate asset ids", async () => {
    mocks.getList
      .mockResolvedValueOnce(listResult({
        page: 1,
        totalItems: 2,
        totalPages: 2,
        items: [{ id: "asset-1", kind: "logo", originalName: "first.png" }],
      }))
      .mockResolvedValueOnce(listResult({
        page: 2,
        totalItems: 2,
        totalPages: 2,
        items: [
          { id: "asset-1", kind: "logo", originalName: "first-duplicate.png" },
          { id: "asset-2", kind: "logo", originalName: "second.svg" },
        ],
      }));
    const { result } = renderHook(() => useUploadedLogoAssets());

    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mocks.getList).toHaveBeenNthCalledWith(2, 2, 48, expect.objectContaining({
      sort: "-updated",
    }));
    expect(result.current.assets.map((asset) => asset.id)).toEqual(["asset-1", "asset-2"]);
  });

  it("exposes load errors and can retry the first page", async () => {
    mocks.getList
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(listResult({ items: [{ id: "asset-retry", kind: "logo" }] }));
    const { result } = renderHook(() => useUploadedLogoAssets());

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(result.current.error?.message).toBe("offline");
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.assets).toEqual([]);

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.assets).toEqual([
      {
        id: "asset-retry",
        url: "/api/app/assets/asset-retry",
        kind: "logo",
        originalName: undefined,
        mimeType: undefined,
        sizeBytes: undefined,
        created: undefined,
        updated: undefined,
      },
    ]);
  });
});
