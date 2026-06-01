import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeCloudflareSession } from "@/services/cloudflare-session";
import type { SessionData } from "./auth-client";
import { authClient } from "./auth-client";

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<FetchMock>(),
  authStoreOnChange: vi.fn(),
  authStoreClear: vi.fn(),
}));

vi.mock("@/services/runtime", () => ({
  renewletRuntime: "cloudflare",
  isCloudflareRuntime: true,
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: {
      isValid: false,
      record: null,
      token: "",
      onChange: mocks.authStoreOnChange,
      clear: mocks.authStoreClear,
    },
    collection: vi.fn(),
  },
}));

const sessionFixture: SessionData = {
  session: { id: "token-1" },
  user: {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "admin",
    banned: false,
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

function sessionResponse(session: SessionData) {
  return new Response(JSON.stringify(session), { status: 200 });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function useTwoSessions() {
  const first = authClient.useSession();
  const second = authClient.useSession();
  return { first, second };
}

describe("authClient.useSession", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockReset();
    mocks.authStoreOnChange.mockReset();
    mocks.authStoreClear.mockReset();
    window.localStorage.clear();
  });

  it("deduplicates simultaneous Cloudflare session validation across consumers", async () => {
    writeCloudflareSession(sessionFixture, { verifiedAt: Date.now() - 120_000 });
    const deferred = createDeferred<Response>();
    mocks.fetch.mockImplementation(() => deferred.promise);

    const { result } = renderHook(() => useTwoSessions(), { wrapper: createWrapper() });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    deferred.resolve(sessionResponse(sessionFixture));

    await waitFor(() => {
      expect(result.current.first.isPending).toBe(false);
      expect(result.current.second.isPending).toBe(false);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = mocks.fetch.mock.calls[0]!;
    const headers = init?.headers;
    expect(input).toBe("/api/app/auth/session");
    expect(init?.credentials).toBe("include");
    expect(headers).toBeInstanceOf(Headers);
    expect((headers as Headers).get("authorization")).toBe("Bearer token-1");
    expect(result.current.first.data?.user.email).toBe("alice@example.com");
    expect(result.current.second.data?.user.email).toBe("alice@example.com");
  });

  it("keeps a verified Cloudflare session fresh across route remounts and page reloads", async () => {
    writeCloudflareSession(sessionFixture);
    mocks.fetch.mockImplementation(() => Promise.resolve(sessionResponse(sessionFixture)));

    const firstRender = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(firstRender.result.current.isPending).toBe(false);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();

    firstRender.unmount();
    const secondRender = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(secondRender.result.current.isPending).toBe(false);
    });
    expect(secondRender.result.current.data?.session.id).toBe("token-1");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("hydrates a login event into existing consumers without validating session again", async () => {
    const { result } = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    expect(result.current.data).toBeNull();
    expect(result.current.isPending).toBe(false);

    writeCloudflareSession(sessionFixture);

    await waitFor(() => {
      expect(result.current.data?.session.id).toBe("token-1");
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("deduplicates stale validation across separate query clients", async () => {
    writeCloudflareSession(sessionFixture, { verifiedAt: Date.now() - 120_000 });
    const deferred = createDeferred<Response>();
    mocks.fetch.mockImplementation(() => deferred.promise);

    const firstRender = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });
    const secondRender = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    deferred.resolve(sessionResponse(sessionFixture));

    await waitFor(() => {
      expect(firstRender.result.current.isPending).toBe(false);
      expect(secondRender.result.current.isPending).toBe(false);
    });
    expect(firstRender.result.current.data?.session.id).toBe("token-1");
    expect(secondRender.result.current.data?.session.id).toBe("token-1");
  });
});
