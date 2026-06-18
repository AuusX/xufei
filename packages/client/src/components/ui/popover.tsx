/**
 * 弹出层设计系统原语。
 *
 * 架构位置：封装 Radix Popover，并优先复用 Dialog portal container，解决弹窗内浮层定位问题。
 *
 * 注意： 该行为会影响 ColorPicker、SearchableSelect、TimePicker 等嵌套在 Dialog 内的控件。
 */
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { X } from "lucide-react";

import { useDialogPortalContainer } from "@/components/ui/dialog";
import {
  getMobileSheetClassName,
  handleMobileOverlayOutsideEvent,
  MobileOverlayBackdrop,
  MobileOverlayPortalHost,
  resolveMobileSheetDetent,
  shouldSuppressMobileOverlayTriggerEvent,
  useControllableOpen,
  useIsMobileOverlay,
  type MobileSheetDetent,
  type MobileSheetKind,
} from "@/components/ui/mobile-overlay";
import { cn } from "@/lib/utils";

const PopoverOpenContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({
  open: false,
  setOpen: () => {},
});

function Popover({
  defaultOpen,
  modal: modalProp,
  onOpenChange,
  open: openProp,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  const isMobileOverlay = useIsMobileOverlay();
  const [open, setOpen] = useControllableOpen({
    defaultOpen,
    onOpenChange,
    open: openProp,
  });

  return (
    <PopoverOpenContext.Provider value={{ open, setOpen }}>
      <PopoverPrimitive.Root
        modal={modalProp ?? isMobileOverlay}
        open={open}
        onOpenChange={setOpen}
        {...props}
      />
    </PopoverOpenContext.Provider>
  );
}

Popover.displayName = PopoverPrimitive.Root.displayName;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ onClickCapture, onPointerDownCapture, ...props }, ref) => (
  <PopoverPrimitive.Trigger
    ref={ref}
    {...props}
    onClickCapture={(event) => {
      if (shouldSuppressMobileOverlayTriggerEvent(event)) return;
      onClickCapture?.(event);
    }}
    onPointerDownCapture={(event) => {
      if (shouldSuppressMobileOverlayTriggerEvent(event)) return;
      onPointerDownCapture?.(event);
    }}
  />
));
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    mobileCloseLabel?: string;
    mobileDescription?: React.ReactNode;
    mobileDetent?: MobileSheetDetent;
    mobileKind?: MobileSheetKind;
    mobilePresentation?: "sheet" | "anchored";
    mobileTitle?: React.ReactNode;
    portalContainer?: HTMLElement | null;
  }
>(({
  className,
  align = "center",
  sideOffset = 4,
  portalContainer,
  mobileCloseLabel = "关闭",
  mobileDescription,
  mobileDetent = "auto",
  mobileKind = "panel",
  mobilePresentation = "sheet",
  mobileTitle,
  children,
  onInteractOutside,
  onPointerDownOutside,
  ...props
}, ref) => {
  const dialogPortalContainer = useDialogPortalContainer();
  const container = portalContainer ?? dialogPortalContainer ?? undefined;
  const { open, setOpen } = React.useContext(PopoverOpenContext);
  const useMobileSheet = mobilePresentation === "sheet";
  const resolvedMobileDetent = resolveMobileSheetDetent({
    kind: mobileKind,
    requestedDetent: mobileDetent,
  });
  const closeCurrentPopover = React.useCallback(() => setOpen(false), [setOpen]);

  return (
    <PopoverPrimitive.Portal container={container}>
      <MobileOverlayPortalHost>
        {open && useMobileSheet ? <MobileOverlayBackdrop onDismiss={closeCurrentPopover} /> : null}
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          data-mobile-detent={resolvedMobileDetent}
          data-mobile-kind={mobileKind}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            if (!event.defaultPrevented) {
              handleMobileOverlayOutsideEvent(event, closeCurrentPopover);
            }
          }}
          onPointerDownOutside={(event) => {
            onPointerDownOutside?.(event);
            if (!event.defaultPrevented) {
              handleMobileOverlayOutsideEvent(event, closeCurrentPopover);
            }
          }}
          className={cn(
            "h5-floating-content z-50 w-72 overflow-hidden rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            useMobileSheet && getMobileSheetClassName({ detent: resolvedMobileDetent, kind: mobileKind }),
            className,
          )}
          {...props}
        >
          {mobileTitle && useMobileSheet ? (
            <div className="-mx-4 -mt-4 mb-4 flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{mobileTitle}</p>
                {mobileDescription ? (
                  <p className="mt-1 text-xs text-muted-foreground">{mobileDescription}</p>
                ) : null}
              </div>
              <PopoverPrimitive.Close className="-mr-2 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background">
                <X className="h-4 w-4" />
                <span className="sr-only">{mobileCloseLabel}</span>
              </PopoverPrimitive.Close>
            </div>
          ) : null}
          {children}
        </PopoverPrimitive.Content>
      </MobileOverlayPortalHost>
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverTrigger, PopoverClose, PopoverContent };
