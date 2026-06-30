/**
 * 带认证头的图片渲染组件。
 *
 * 架构位置：
 * - 自定义配置和订阅 Logo 可能指向 `/api/app/assets/...` 私有资产。
 * - 浏览器原生 `<img>` 无法附加 PocketBase Authorization header，因此这里先 fetch 为 Blob，再转 object URL。
 *
 * 状态链路：
 * ```
 * 图片 src -> 判断是否私有资产 -> fetch(blob + auth) -> createObjectURL -> img
 * src 变化/卸载 -> abort fetch -> revokeObjectURL
 * ```
 *
 * 注意： object URL 必须在 src 变化或卸载时释放，否则长时间管理图标会造成内存泄漏。
 */
import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { getAuthHeader } from "@/lib/pocketbase";
import { isExternalHttpImageSrc, resolveDisplayLogoSrc } from "@/lib/logo-url";

type AuthorizedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  /** 支持私有资产代理路径和外部 http(s) 图片；显示前会按当前页面协议做安全降级/升级。 */
  src: string;
  /** 加载失败只通知调用方切换 fallback，不暴露 fetch 细节。 */
  onError?: (() => void) | undefined;
};

function isPrivateAssetUrl(src: string): boolean {
  if (src.startsWith("/api/app/assets/")) return true;
  try {
    const url = new URL(src, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/app/assets/");
  } catch {
    return false;
  }
}

function useAuthorizedImageSrc(src: string | undefined): { src: string | undefined; failed: boolean } {
  const shouldAuthorize = useMemo(() => Boolean(src && isPrivateAssetUrl(src)), [src]);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() => (src && shouldAuthorize ? undefined : src));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!src) {
      setResolvedSrc(undefined);
      return;
    }
    if (!shouldAuthorize) {
      setResolvedSrc(src);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;

    setResolvedSrc(undefined);
    void (async () => {
      try {
        const response = await fetch(src, {
          credentials: "include",
          headers: getAuthHeader(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        // 用 object URL 交给 <img> 渲染，可以保留浏览器图片解码能力，同时避免把认证 token 暴露在 URL 上。
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shouldAuthorize, src]);

  return { src: resolvedSrc, failed };
}

/** AuthorizedImage 统一处理私有资产鉴权、object URL 生命周期和外链 referrer 策略。 */
export function AuthorizedImage({ src, onError, ...props }: AuthorizedImageProps) {
  const displaySrc = useMemo(() => resolveDisplayLogoSrc(src), [src]);
  const image = useAuthorizedImageSrc(displaySrc);
  const referrerPolicy = props.referrerPolicy ?? (displaySrc && isExternalHttpImageSrc(displaySrc) ? "no-referrer" : undefined);

  useEffect(() => {
    // resolveDisplayLogoSrc 可能因 mixed content/IP host 返回 undefined；调用方应走占位图而不是渲染坏 URL。
    if (!displaySrc || image.failed) onError?.();
  }, [displaySrc, image.failed, onError]);

  if (!image.src) return null;

  return (
    <img
      {...props}
      src={image.src}
      loading={props.loading ?? "lazy"}
      decoding={props.decoding ?? "async"}
      referrerPolicy={referrerPolicy}
      onError={() => {
        onError?.();
      }}
    />
  );
}
