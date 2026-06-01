import { describe, expect, it, vi } from "vitest";
import { toast, useToast } from "./use-toast";

type SonnerToastOptions = {
  id?: string;
  description?: unknown;
};

type SonnerToastMock = (message: unknown, options?: SonnerToastOptions) => void;
type SonnerDismissMock = (id?: string) => void;

const mocks = vi.hoisted(() => ({
  success: vi.fn<SonnerToastMock>(),
  error: vi.fn<SonnerToastMock>(),
  dismiss: vi.fn<SonnerDismissMock>(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
    dismiss: mocks.dismiss,
  },
}));

describe("useToast Sonner adapter", () => {
  it("maps default shadcn-style toasts to success toasts", () => {
    toast({
      title: "设置已保存",
      description: "所有更改已同步。",
    });

    expect(mocks.success).toHaveBeenCalledWith(
      "设置已保存",
      expect.objectContaining({
        description: "所有更改已同步。",
      }),
    );
    expect(typeof mocks.success.mock.calls[0]?.[1]?.id).toBe("string");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("maps destructive shadcn-style toasts to error toasts", () => {
    toast({
      title: "保存失败",
      description: "无法保存设置，请稍后重试",
      variant: "destructive",
    });

    expect(mocks.error).toHaveBeenCalledWith(
      "保存失败",
      expect.objectContaining({
        description: "无法保存设置，请稍后重试",
      }),
    );
    expect(typeof mocks.error.mock.calls[0]?.[1]?.id).toBe("string");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps dismiss and update pinned to the same toast id", () => {
    const handle = toast({
      title: "设置已保存",
      description: "所有更改已同步。",
    });

    handle.update({
      id: handle.id,
      title: "设置已更新",
      description: "最新配置已同步。",
    });
    handle.dismiss();

    expect(mocks.success).toHaveBeenLastCalledWith(
      "设置已更新",
      expect.objectContaining({
        description: "最新配置已同步。",
        id: handle.id,
      }),
    );
    expect(mocks.dismiss).toHaveBeenCalledWith(handle.id);
  });

  it("exposes a global dismiss helper from useToast", () => {
    const { dismiss } = useToast();

    dismiss("toast-id");

    expect(mocks.dismiss).toHaveBeenCalledWith("toast-id");
  });
});
