import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

describe("DropdownMenu mobile sheet", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
  });

  afterEach(() => {
    document.body.removeAttribute("data-mobile-overlay-open");
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("opens from the trigger click without activating an item from the same tap", async () => {
    mockMobileOverlayMatch();
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">更多操作</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>编辑</DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete}>删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole("button", { name: "更多操作" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByRole("menuitem", { name: "编辑" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeVisible();

    await user.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("only reserves leading icon space for checked or inset mobile menu items", async () => {
    mockMobileOverlayMatch();
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">更多操作</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>编辑</DropdownMenuItem>
          <DropdownMenuItem inset>缩进项</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>已选项</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole("button", { name: "更多操作" }));

    expect(await screen.findByRole("menuitem", { name: "编辑" })).toHaveClass("h5-mobile-option-item");
    expect(screen.getByRole("menuitem", { name: "编辑" })).not.toHaveClass("h5-mobile-option-item-leading");
    expect(screen.getByRole("menuitem", { name: "缩进项" })).toHaveClass("h5-mobile-option-item-leading");
    expect(screen.getByRole("menuitemcheckbox", { name: "已选项" })).toHaveClass("h5-mobile-option-item-leading");
  });
});
