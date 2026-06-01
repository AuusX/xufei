import type { MouseEventHandler } from "react";
import { Check } from "lucide-react";
import { FaviconResultImage } from "@/components/favicon-result-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

type MediaThumbnailSize = "sm" | "md";
const MEDIA_THUMBNAIL_TOOLTIP_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 768px)";

interface MediaThumbnailButtonProps {
  src: string;
  alt: string;
  selected: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string | undefined;
  onError?: (() => void) | undefined;
  size?: MediaThumbnailSize | undefined;
  tooltip?: string | undefined;
}

export function useMediaThumbnailTooltipEnabled() {
  // 缩略图候选常在 H5 sheet 的滚动区里；窄屏/触控不挂 Tooltip，避免长按、悬浮和拖动滚动抢同一套指针事件。
  return useMediaQuery(MEDIA_THUMBNAIL_TOOLTIP_QUERY);
}

export function MediaThumbnailButton({
  src,
  alt,
  selected,
  onClick,
  className,
  onError,
  size = "md",
  tooltip,
}: MediaThumbnailButtonProps) {
  const isSmall = size === "sm";
  const tooltipEnabled = useMediaThumbnailTooltipEnabled();

  const button = (
    <button
      type="button"
      aria-label={alt}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "media-thumbnail-canvas relative flex items-center justify-center rounded-lg",
        "border transition-all hover:border-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isSmall ? "h-12 w-12 border p-1" : "h-14 w-14 border-2 p-1.5",
        selected
          ? cn("border-primary", isSmall ? "ring-1 ring-primary/30" : "ring-2 ring-primary/20")
          : "border-border",
        className,
      )}
    >
      <div className="relative z-10 h-full w-full">
        <FaviconResultImage src={src} alt={alt} className="media-thumbnail-image" onError={onError} />
      </div>
      {selected && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-1 -top-1 z-20 flex items-center justify-center rounded-full bg-primary",
            isSmall ? "h-3.5 w-3.5" : "h-4 w-4",
          )}
        >
          <Check className={cn("text-primary-foreground", isSmall ? "h-2 w-2" : "h-3 w-3")} />
        </span>
      )}
    </button>
  );

  if (!tooltip || !tooltipEnabled) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-[calc(100vw-2rem)] whitespace-normal break-words text-xs leading-relaxed sm:max-w-md"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
