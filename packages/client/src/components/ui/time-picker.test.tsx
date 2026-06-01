import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimePicker } from "./time-picker";

function installScrollMocks() {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
      if (typeof options === "object") {
        this.scrollTop = options.top ?? this.scrollTop;
        return;
      }

      if (typeof y === "number") {
        this.scrollTop = y;
      }
    },
  });

  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}

async function openPicker(value = "08:12", onChange = vi.fn()) {
  const user = userEvent.setup();

  render(<TimePicker value={value} onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: new RegExp(value) }));

  return {
    onChange,
    hourColumn: await screen.findByRole("spinbutton", { name: "时" }),
    minuteColumn: await screen.findByRole("spinbutton", { name: "分" }),
  };
}

describe("TimePicker", () => {
  beforeEach(() => {
    installScrollMocks();
  });

  it("renders the current time and exposes wheel column values", async () => {
    const { hourColumn, minuteColumn } = await openPicker("08:12");

    expect(screen.getByRole("button", { name: /08:12/ })).toBeInTheDocument();
    expect(hourColumn).toHaveAttribute("aria-valuenow", "8");
    expect(hourColumn).toHaveAttribute("aria-valuetext", "08");
    expect(minuteColumn).toHaveAttribute("aria-valuenow", "12");
    expect(minuteColumn).toHaveAttribute("aria-valuetext", "12");
  });

  it("selects an option by click", async () => {
    const onChange = vi.fn();
    const { hourColumn } = await openPicker("08:12", onChange);

    fireEvent.click(within(hourColumn).getByText("09"));

    expect(onChange).toHaveBeenLastCalledWith("09:12");
    expect(screen.getByRole("button", { name: /09:12/ })).toBeInTheDocument();
  });

  it("syncs wheel columns when the controlled value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TimePicker value="08:12" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /08:12/ }));
    rerender(<TimePicker value="21:01" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /21:01/ })).toBeInTheDocument();
      expect(screen.getByRole("spinbutton", { name: "时" })).toHaveAttribute("aria-valuenow", "21");
      expect(screen.getByRole("spinbutton", { name: "分" })).toHaveAttribute("aria-valuenow", "1");
    });
  });

  it("snaps to the nearest item after mouse drag", async () => {
    const onChange = vi.fn();
    const { hourColumn } = await openPicker("08:12", onChange);

    expect(hourColumn.scrollTop).toBe(320);

    fireEvent.pointerDown(hourColumn, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 100 });
    fireEvent.pointerMove(hourColumn, { pointerId: 1, pointerType: "mouse", buttons: 1, clientY: 20 });

    expect(hourColumn).toHaveAttribute("aria-valuenow", "10");

    fireEvent.pointerUp(hourColumn, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 20 });

    expect(onChange).toHaveBeenLastCalledWith("10:12");
    expect(hourColumn.scrollTop).toBe(400);
  });

  it("snaps native scroll changes after the debounce window", async () => {
    const onChange = vi.fn();
    const { minuteColumn } = await openPicker("08:12", onChange);
    vi.useFakeTimers();

    minuteColumn.scrollTop = 16 * 40;
    fireEvent.scroll(minuteColumn);

    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);

    expect(onChange).toHaveBeenLastCalledWith("08:16");
    expect(minuteColumn.scrollTop).toBe(640);
  });

  it("suppresses the click that follows a drag", async () => {
    const onChange = vi.fn();
    const { hourColumn } = await openPicker("08:12", onChange);

    fireEvent.pointerDown(hourColumn, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 100 });
    fireEvent.pointerMove(hourColumn, { pointerId: 1, pointerType: "mouse", buttons: 1, clientY: 20 });
    fireEvent.pointerUp(hourColumn, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 20 });
    fireEvent.click(within(hourColumn).getByText("23"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("10:12");
  });

  it("supports keyboard increment, decrement, and boundaries", async () => {
    const onChange = vi.fn();
    const { hourColumn } = await openPicker("08:12", onChange);

    fireEvent.keyDown(hourColumn, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("09:12");

    fireEvent.keyDown(hourColumn, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("08:12");

    fireEvent.keyDown(hourColumn, { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith("03:12");

    fireEvent.keyDown(hourColumn, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("00:12");

    fireEvent.keyDown(hourColumn, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(4);

    fireEvent.keyDown(hourColumn, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("23:12");

    fireEvent.keyDown(hourColumn, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(5);
  });
});
