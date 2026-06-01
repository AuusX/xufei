/**
 * 已上传 Logo 资产列表 Hook。
 *
 * 架构位置：
 * - LogoPicker 通过它读取当前用户已上传的 `assets.kind=logo` 私有资产。
 * - 读取通过当前运行时资产服务；后端/D1 都必须限制只能看到当前用户资产。
 *
 * 状态链路：
 * ```
 * 打开选择器 -> getList(kind=logo, -updated) -> /api/app/assets/{id} -> AuthorizedImage
 * 加载更多 -> 追加下一页并按 id 去重
 * 过期请求 -> token 不匹配 -> 忽略
 * ```
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { assetService, type UploadedAsset } from "@/services/asset-service";

export interface UseUploadedLogoAssetsResult {
  assets: UploadedAsset[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

function mergeAssets(current: UploadedAsset[], next: UploadedAsset[]): UploadedAsset[] {
  const seen = new Set(current.map((asset) => asset.id));
  const merged = [...current];
  for (const asset of next) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
}

export function useUploadedLogoAssets(): UseUploadedLogoAssetsResult {
  const requestTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // React StrictMode 会在开发环境额外执行一次 setup -> cleanup -> setup；
    // setup 必须恢复 mounted 标记，否则后续真实请求结果会被当成卸载后的过期响应丢弃。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
    };
  }, []);

  const loadPage = useCallback(async (nextPage: number) => {
    const isFirstPage = nextPage === 1;
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    const isCurrentRequest = () => mountedRef.current && requestTokenRef.current === token;

    if (isFirstPage) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);

    try {
      const result = await assetService.listLogos(nextPage);
      // Logo 选择器可能在 sheet 关闭后仍有请求返回；token 防止过期响应复活旧列表。
      if (!isCurrentRequest()) return;

      setAssets((current) => (isFirstPage ? result.items : mergeAssets(current, result.items)));
      setPage(result.page);
      setTotalPages(result.totalPages);
      setHasLoaded(true);
    } catch (err: unknown) {
      if (isCurrentRequest()) {
        setError(err instanceof Error ? err : new Error("Uploaded logo assets load failed"));
        setHasLoaded(true);
      }
    } finally {
      if (isCurrentRequest()) {
        if (isFirstPage) {
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    }
  }, []);

  const loadInitial = useCallback(() => loadPage(1), [loadPage]);

  const hasMore = hasLoaded && page < totalPages;

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await loadPage(page + 1);
  }, [hasMore, isLoading, isLoadingMore, loadPage, page]);

  const reset = useCallback(() => {
    requestTokenRef.current += 1;
    setAssets([]);
    setPage(0);
    setTotalPages(0);
    setHasLoaded(false);
    setIsLoading(false);
    setIsLoadingMore(false);
    setError(null);
  }, []);

  return {
    assets,
    error,
    hasLoaded,
    hasMore,
    isLoading,
    isLoadingMore,
    loadInitial,
    loadMore,
    reset,
  };
}
