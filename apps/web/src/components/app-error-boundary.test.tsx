import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { appErrorBoundaryBrowser, AppErrorBoundary } from "./app-error-boundary";

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "appError.title": "页面暂时无法显示",
      "appError.description": "发生了一个未预期的界面错误。你可以刷新页面重新加载，已保存的数据不会受到影响。",
      "appError.reload": "刷新页面",
    }[key] ?? key),
  }),
}));

function BrokenChild(): never {
  throw new Error("render failed");
}

describe("AppErrorBoundary", () => {
  it("renders children during the normal path", () => {
    render(
      <AppErrorBoundary>
        <p>正常内容</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("renders a recoverable fallback when a child throws", async () => {
    const reload = vi.fn();
    const reloadSpy = vi.spyOn(appErrorBoundaryBrowser, "reload").mockImplementation(reload);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <AppErrorBoundary>
          <BrokenChild />
        </AppErrorBoundary>,
      );

      expect(screen.getByText("页面暂时无法显示")).toBeInTheDocument();
      expect(screen.getByText("发生了一个未预期的界面错误。你可以刷新页面重新加载，已保存的数据不会受到影响。")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "刷新页面" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      reloadSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
