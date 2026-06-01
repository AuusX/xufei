import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class MemoryStorageMock implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const value = globalThis[name] as Storage | undefined;
  if (typeof value?.clear === "function" && typeof value?.setItem === "function") return;
  vi.stubGlobal(name, new MemoryStorageMock());
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
ensureStorage("localStorage");
ensureStorage("sessionStorage");
localStorage.setItem("renewlet_locale", "zh-CN");
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  ensureStorage("localStorage");
  ensureStorage("sessionStorage");
  localStorage.clear();
  localStorage.setItem("renewlet_locale", "zh-CN");
  sessionStorage.clear();
});
