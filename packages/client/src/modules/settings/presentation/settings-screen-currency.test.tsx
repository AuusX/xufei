// SettingsScreen 货币测试保护选择器顺序跟随货币管理持久配置，而不是页面层临时重排。
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import {
  createControllerState,
  createUploadedAssetsManagerState,
  mocks,
  renderSettingsScreen,
} from "./settings-screen.test-utils";

describe("SettingsScreen currency selectors", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    mocks.useSettingsFormController.mockReturnValue(createControllerState());
    mocks.useUploadedAssetsManager.mockReturnValue(createUploadedAssetsManagerState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the persisted currency manager order for the reporting currency selector", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      settings: {
        defaultCurrency: "USD",
      },
      customConfig: {
        ...DEFAULT_CUSTOM_CONFIG,
        currencies: [
          {
            id: "PHP",
            value: "PHP",
            labels: { "zh-CN": "₱ 菲律宾比索 (PHP)", "en-US": "₱ Philippine Peso (PHP)" },
            enabled: true,
          },
          {
            id: "AED",
            value: "AED",
            labels: { "zh-CN": "AED 阿联酋迪拉姆", "en-US": "AED United Arab Emirates Dirham" },
            enabled: true,
          },
          {
            id: "USD",
            value: "USD",
            labels: { "zh-CN": "$ 美元 (USD)", "en-US": "$ US Dollar (USD)" },
            enabled: true,
          },
          {
            id: "CNY",
            value: "CNY",
            labels: { "zh-CN": "¥ 人民币 (CNY)", "en-US": "¥ Chinese Yuan (CNY)" },
            enabled: true,
          },
        ],
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    await user.click(screen.getByRole("combobox", { name: "统计货币" }));

    expect(controller.handleDefaultCurrencyChange).toHaveBeenCalledWith("PHP");
  });
});
