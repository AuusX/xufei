// Provider 测试保护语言真相源优先级：自动探测、远端 settings、本地预览和保存偏好必须各走各的边界。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { getApiLocale, setApiLocale } from "@/i18n/api-locale";
import { EXPLICIT_LOCALE_PREFERENCE_KEY, type Locale } from "@/i18n/locales";

const mocks = vi.hoisted(() => ({
  settings: undefined as { locale: Locale } | undefined,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  SETTINGS_QUERY_KEY: ["settings"],
  useSettings: () => ({ data: mocks.settings }),
  useUpdateSettings: () => ({ mutate: mocks.updateSettings }),
}));

let restoreNavigator: (() => void) | null = null;

function stubNavigatorLanguages(languages: string[], language = languages[0] ?? "") {
  restoreNavigator?.();
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { languages, language },
  });
  restoreNavigator = () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
    restoreNavigator = null;
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  };
}

describe("I18nProvider locale sources", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
    setApiLocale("en-US");
    mocks.settings = undefined;
    mocks.updateSettings.mockReset();
  });

  afterEach(() => {
    restoreNavigator?.();
  });

  it("uses browser detection without persisting an explicit preference", async () => {
    stubNavigatorLanguages(["zh-CN"]);

    const { result } = renderHook(() => useI18n(), { wrapper: createWrapper() });

    expect(result.current.locale).toBe("zh-CN");
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(getApiLocale()).toBe("zh-CN");
    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBeNull();
  });

  it("lets remote settings override the automatic initial language", async () => {
    mocks.settings = { locale: "en-US" };
    stubNavigatorLanguages(["zh-CN"]);

    const { result } = renderHook(() => useI18n(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.locale).toBe("en-US"));
    expect(document.documentElement.lang).toBe("en-US");
    expect(getApiLocale()).toBe("en-US");
    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBeNull();
  });

  it("keeps settings-page preview local until the language is saved", async () => {
    mocks.settings = { locale: "en-US" };
    stubNavigatorLanguages(["en-US"]);

    const { result } = renderHook(() => useI18n(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.locale).toBe("en-US"));

    act(() => {
      result.current.setLocale("zh-CN", { persist: false });
    });

    expect(result.current.locale).toBe("zh-CN");
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    expect(getApiLocale()).toBe("en-US");
    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBeNull();
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    act(() => {
      result.current.setLocale("zh-CN", { persist: false, markAsSaved: true, rememberPreference: true });
    });

    expect(getApiLocale()).toBe("zh-CN");
    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBe("zh-CN");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("can restore the saved account locale without writing an explicit preference", async () => {
    mocks.settings = { locale: "en-US" };
    stubNavigatorLanguages(["en-US"]);

    const { result } = renderHook(() => useI18n(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.locale).toBe("en-US"));

    act(() => {
      result.current.setLocale("zh-CN", { persist: false });
    });
    act(() => {
      result.current.setLocale("en-US", { persist: false, markAsSaved: true });
    });

    expect(result.current.locale).toBe("en-US");
    expect(getApiLocale()).toBe("en-US");
    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBeNull();
  });
});
