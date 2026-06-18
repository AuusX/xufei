import * as React from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export const MOBILE_OVERLAY_QUERY = "(max-width: 767px)";
export const MOBILE_SHEET_LARGE_ITEM_THRESHOLD = 10;

export type MobileSheetDetent = "auto" | "compact" | "large";
export type ResolvedMobileSheetDetent = Exclude<MobileSheetDetent, "auto">;
export type MobileSheetKind = "list" | "calendar" | "panel";

// 移动端遮罩可能来自多个 Radix Portal；模块级计数让 body 锁定和触发器防穿透共用同一事实源。
let activeMobileBackdropCount = 0;
type MobileOverlayInteractionPoint = {
  x: number;
  y: number;
};

type MobileOverlayTriggerSuppression = {
  expiresAt: number;
  point?: MobileOverlayInteractionPoint | undefined;
};

let mobileOverlayTriggerSuppression: MobileOverlayTriggerSuppression | undefined;
let clearMobileOverlayTriggerSuppressionTimer: ReturnType<typeof setTimeout> | undefined;
const mobileOverlayStateListeners = new Set<() => void>();
const MOBILE_OVERLAY_TRIGGER_SUPPRESSION_MS = 450;
const MOBILE_OVERLAY_TRIGGER_SUPPRESSION_RADIUS_PX = 24;

function subscribeMobileOverlayState(listener: () => void) {
  mobileOverlayStateListeners.add(listener);
  return () => {
    mobileOverlayStateListeners.delete(listener);
  };
}

function getMobileOverlayStateSnapshot() {
  return activeMobileBackdropCount > 0;
}

function updateMobileOverlayOpenState() {
  if (typeof document === "undefined") return;

  if (activeMobileBackdropCount > 0) {
    document.body.setAttribute("data-mobile-overlay-open", "");
    return;
  }

  document.body.removeAttribute("data-mobile-overlay-open");
}

function emitMobileOverlayStateChange() {
  mobileOverlayStateListeners.forEach((listener) => listener());
}

function registerMobileOverlayBackdrop() {
  activeMobileBackdropCount += 1;
  updateMobileOverlayOpenState();
  emitMobileOverlayStateChange();

  return () => {
    activeMobileBackdropCount = Math.max(0, activeMobileBackdropCount - 1);
    updateMobileOverlayOpenState();
    emitMobileOverlayStateChange();
  };
}

/** useIsMobileOverlay 判断当前交互是否应切换为 H5 sheet/overlay 形态。 */
export function useIsMobileOverlay() {
  return useMediaQuery(MOBILE_OVERLAY_QUERY);
}

/** useHasActiveMobileOverlayBackdrop 暴露全局遮罩存在性，供触发器避免同一次 tap 重新打开弹层。 */
export function useHasActiveMobileOverlayBackdrop() {
  return React.useSyncExternalStore(
    subscribeMobileOverlayState,
    getMobileOverlayStateSnapshot,
    () => false,
  );
}

/** useControllableOpen 统一 Radix 风格的 controlled/uncontrolled open 状态。 */
export function useControllableOpen({
  defaultOpen = false,
  onOpenChange,
  open,
}: {
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return [currentOpen, setOpen] as const;
}

export function MobileOverlayPortalHost({ children }: { children: React.ReactNode }) {
  // Dialog 内的 portal host 会成为 flex/grid 子项；display:contents 保留 DOM 边界，避免父级 gap 撑高 footer。
  return (
    <div data-mobile-overlay-portal="" className="contents">
      {children}
    </div>
  );
}

/** resolveMobileSheetDetent 将调用方意图映射成实际 sheet 高度档位。 */
export function resolveMobileSheetDetent({
  itemCount,
  kind = "panel",
  requestedDetent = "auto",
}: {
  itemCount?: number | undefined;
  kind?: MobileSheetKind | undefined;
  requestedDetent?: MobileSheetDetent | undefined;
}): ResolvedMobileSheetDetent {
  if (requestedDetent === "compact" || requestedDetent === "large") {
    return requestedDetent;
  }

  if (kind === "list" && typeof itemCount === "number" && itemCount > MOBILE_SHEET_LARGE_ITEM_THRESHOLD) {
    return "large";
  }

  return "compact";
}

/** isMobileOverlayBackdropTarget 判断 Radix outside event 是否命中了移动端自定义遮罩。 */
export function isMobileOverlayBackdropTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-mobile-overlay-backdrop]") !== null;
}

/** stopMobileOverlayBackdropEvent 阻止遮罩事件穿透到下层 Dialog 或触发按钮。 */
export function stopMobileOverlayBackdropEvent(event: Pick<Event, "preventDefault" | "stopPropagation">) {
  event.preventDefault();
  event.stopPropagation();
}

type MobileOverlayInteractionEvent = (Event | React.SyntheticEvent) & {
  changedTouches?: TouchList;
  clientX?: number;
  clientY?: number;
  nativeEvent?: Event & {
    changedTouches?: TouchList;
    clientX?: number;
    clientY?: number;
  };
};

function getMobileOverlayInteractionPoint(
  event: MobileOverlayInteractionEvent | undefined,
): MobileOverlayInteractionPoint | undefined {
  const source = event && "nativeEvent" in event ? event.nativeEvent : event;
  if (!source) return undefined;

  if (typeof source.clientX === "number" && typeof source.clientY === "number") {
    return { x: source.clientX, y: source.clientY };
  }

  const touch = source.changedTouches?.[0];
  if (touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  return undefined;
}

function isWithinMobileOverlaySuppressionPoint(
  interactionPoint: MobileOverlayInteractionPoint | undefined,
  eventPoint: MobileOverlayInteractionPoint | undefined,
) {
  if (!interactionPoint || !eventPoint) return true;

  return (
    Math.abs(interactionPoint.x - eventPoint.x) <= MOBILE_OVERLAY_TRIGGER_SUPPRESSION_RADIUS_PX &&
    Math.abs(interactionPoint.y - eventPoint.y) <= MOBILE_OVERLAY_TRIGGER_SUPPRESSION_RADIUS_PX
  );
}

function clearExpiredMobileOverlayTriggerSuppression() {
  if (!mobileOverlayTriggerSuppression) return;
  if (Date.now() <= mobileOverlayTriggerSuppression.expiresAt) return;

  mobileOverlayTriggerSuppression = undefined;
  if (clearMobileOverlayTriggerSuppressionTimer) {
    clearTimeout(clearMobileOverlayTriggerSuppressionTimer);
    clearMobileOverlayTriggerSuppressionTimer = undefined;
  }
}

function markMobileOverlayBackdropInteraction(event?: MobileOverlayInteractionEvent) {
  // 移动浏览器会在 portal 卸载后补发兼容 click；短时坐标闸门只拦同一次遮罩点击，不挡用户点别处。
  mobileOverlayTriggerSuppression = {
    expiresAt: Date.now() + MOBILE_OVERLAY_TRIGGER_SUPPRESSION_MS,
    point: getMobileOverlayInteractionPoint(event),
  };

  if (clearMobileOverlayTriggerSuppressionTimer) {
    clearTimeout(clearMobileOverlayTriggerSuppressionTimer);
  }
  clearMobileOverlayTriggerSuppressionTimer = setTimeout(() => {
    mobileOverlayTriggerSuppression = undefined;
    clearMobileOverlayTriggerSuppressionTimer = undefined;
  }, MOBILE_OVERLAY_TRIGGER_SUPPRESSION_MS);
}

export function shouldSuppressMobileOverlayTriggerEvent(
  event: Pick<React.SyntheticEvent, "preventDefault" | "stopPropagation"> & MobileOverlayInteractionEvent,
) {
  clearExpiredMobileOverlayTriggerSuppression();
  if (!mobileOverlayTriggerSuppression) return false;

  const eventPoint = getMobileOverlayInteractionPoint(event);
  if (!isWithinMobileOverlaySuppressionPoint(mobileOverlayTriggerSuppression.point, eventPoint)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** handleMobileOverlayOutsideEvent 让 Radix outside 事件与自定义遮罩关闭语义保持一致。 */
export function handleMobileOverlayOutsideEvent(
  event: {
    detail?: { originalEvent?: Event };
    target: EventTarget | null;
    preventDefault: () => void;
  },
  _onDismiss?: (() => void) | undefined,
) {
  const originalTarget = event.detail?.originalEvent?.target ?? event.target;
  if (!isMobileOverlayBackdropTarget(originalTarget)) return false;

  // Radix 比 React 更早收到 outside pointer；这里阻止立即卸载，避免同一次 tap 穿透到底层 Dialog/触发器。
  event.preventDefault();
  markMobileOverlayBackdropInteraction(event.detail?.originalEvent);
  return true;
}

/** getMobileSheetClassName 集中维护 sheet 形态类名，避免各弹层复制移动端高度策略。 */
export function getMobileSheetClassName({
  detent,
  kind,
}: {
  detent: ResolvedMobileSheetDetent;
  kind: MobileSheetKind;
}) {
  return cn(
    "h5-mobile-sheet-content",
    detent === "compact" && "h5-mobile-sheet-compact",
    detent === "large" && "h5-mobile-sheet-large",
    kind === "list" && "h5-mobile-sheet-list",
    kind === "calendar" && "h5-mobile-sheet-calendar",
    kind === "panel" && "h5-mobile-sheet-panel",
  );
}

/**
 * MobileOverlayBackdrop 是 H5 sheet 的事件隔离层。
 *
 * 它不只负责视觉遮罩，还负责记录最近一次遮罩交互坐标，解决移动浏览器在 Portal 卸载后
 * 把同一次 tap 派发给底层触发器的问题。
 */
export function MobileOverlayBackdrop({
  className,
  onDismiss,
  onClick,
  onClickCapture,
  onPointerDown,
  onPointerDownCapture,
  onPointerUp,
  onPointerUpCapture,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  onDismiss?: (() => void) | undefined;
}) {
  const isMobileOverlay = useIsMobileOverlay();

  React.useEffect(() => {
    if (!isMobileOverlay) return undefined;

    // 嵌套 Radix portal 会拆开 DialogOverlay 与 sheet 层级；全局计数给测试和触发器防穿透同一事实源。
    return registerMobileOverlayBackdrop();
  }, [isMobileOverlay]);

  return (
    <div
      aria-hidden="true"
      data-mobile-overlay-backdrop=""
      className={cn("h5-mobile-overlay-backdrop", className)}
      style={{ ...style, pointerEvents: "auto" }}
      {...props}
      onClickCapture={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onDismiss?.();
        onClickCapture?.(event);
      }}
      onClick={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onClick?.(event);
      }}
      onPointerDownCapture={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onPointerDownCapture?.(event);
      }}
      onPointerDown={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onPointerDown?.(event);
      }}
      onPointerUpCapture={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onPointerUpCapture?.(event);
      }}
      onPointerUp={(event) => {
        markMobileOverlayBackdropInteraction(event);
        stopMobileOverlayBackdropEvent(event);
        onPointerUp?.(event);
      }}
    />
  );
}
