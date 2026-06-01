import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function mockMobileOverlayMatch() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function SelectWithOptions({ count }: { count: number }) {
  return (
    <Select open value="item-0">
      <SelectTrigger aria-label="测试选择">
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-testid="select-sheet">
        {Array.from({ length: count }, (_, index) => (
          <SelectItem key={index} value={`item-${index}`} disabled={index === count - 1}>
            选项 {index}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

describe("Select mobile sheet", () => {
  afterEach(() => {
    document.body.removeAttribute("data-mobile-overlay-open");
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("uses compact detent for short option lists", async () => {
    render(<SelectWithOptions count={2} />);

    const sheet = await screen.findByTestId("select-sheet");
    expect(sheet).toHaveAttribute("data-mobile-detent", "compact");
    expect(sheet).toHaveClass("h5-mobile-sheet-compact");
    expect(screen.getByRole("option", { name: "选项 1" })).toHaveClass("h5-mobile-option-item");
    expect(screen.getByRole("option", { name: "选项 1" })).toHaveClass("h5-mobile-option-item-leading");
    expect(screen.getByRole("option", { name: "选项 1" })).toHaveAttribute("data-disabled");
  });

  it("uses large detent for long option lists", async () => {
    render(<SelectWithOptions count={20} />);

    const sheet = await screen.findByTestId("select-sheet");
    expect(sheet).toHaveAttribute("data-mobile-detent", "large");
    expect(sheet).toHaveClass("h5-mobile-sheet-large");
  });

  it("closes only the nested select when tapping the mobile backdrop inside a dialog", async () => {
    mockMobileOverlayMatch();
    const underlayClick = vi.fn();

    function Harness() {
      const [selectOpen, setSelectOpen] = React.useState(true);

      return (
        <Dialog open>
          <DialogContent>
            <DialogTitle>添加新订阅</DialogTitle>
            <DialogDescription className="sr-only">测试选择器背景点击。</DialogDescription>
            <button type="button" onClick={underlayClick}>
              支付方式
            </button>
            <Select open={selectOpen} onOpenChange={setSelectOpen} value="alipay">
              <SelectTrigger aria-label="支付方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent data-testid="payment-select-sheet">
                <SelectItem value="alipay">支付宝</SelectItem>
                <SelectItem value="wechat">微信支付</SelectItem>
              </SelectContent>
            </Select>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);

    const sheet = await screen.findByTestId("payment-select-sheet");
    const backdrop = sheet.closest("[data-mobile-overlay-portal]")?.querySelector("[data-mobile-overlay-backdrop]");
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveStyle({ pointerEvents: "auto" });
    await waitFor(() => {
      expect(document.body).toHaveAttribute("data-mobile-overlay-open");
    });
    expect(document.querySelector("[data-dialog-overlay]")).not.toHaveClass("pointer-events-none");

    fireEvent.pointerDown(backdrop as Element);
    expect(screen.getByTestId("payment-select-sheet")).toBeInTheDocument();
    fireEvent.click(backdrop as Element);

    await waitFor(() => {
      expect(screen.queryByTestId("payment-select-sheet")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.body).not.toHaveAttribute("data-mobile-overlay-open");
    });
    expect(screen.getByRole("dialog", { name: "添加新订阅" })).toBeVisible();
    expect(underlayClick).not.toHaveBeenCalled();
  });
});
