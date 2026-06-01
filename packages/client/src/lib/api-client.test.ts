import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api-client";
import { okResponseSchema } from "@/lib/api/schemas/common";

describe("api-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses successful JSON responses and sends JSON content-type by default", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(apiFetch("/api/example", okResponseSchema)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/example");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
    expect((init.headers as Headers).get("Accept-Language")).toBeTruthy();
    expect((init.headers as Headers).get("X-Renewlet-Locale")).toBeTruthy();
  });

  it("does not rewrite legacy API paths", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch("/api/setup", okResponseSchema);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/setup");
  });

  it("throws ApiError with backend message and status on non-2xx responses", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Bad payload" }), { status: 400 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      name: "ApiError",
      message: "Bad payload",
      status: 400,
    });
  });

  it("reads problem details and backend codes from non-2xx responses", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: "请先登录后再操作",
      code: "UNAUTHORIZED",
      title: "未登录",
      status: 401,
      detail: "请先登录后再操作",
    }), { status: 401 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      name: "ApiError",
      message: "请先登录后再操作",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("turns legacy Zod field errors into a readable message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: "Invalid payload",
      details: {
        formErrors: [],
        fieldErrors: {
          email: ["邮箱格式无效"],
          password: ["密码至少需要 8 位"],
        },
      },
    }), { status: 400 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      message: "请求参数无效：email: 邮箱格式无效；password: 密码至少需要 8 位",
      status: 400,
    });
  });

  it("falls back to statusText when an error response is not JSON", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("not-json", { status: 502, statusText: "Bad Gateway" }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      message: "Bad Gateway",
      status: 502,
    });
  });

  it("classifies timeout aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));

    const promise = apiFetch("/api/slow", okResponseSchema, { timeoutMs: 50 });
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "timeout",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });

  it("classifies caller-initiated aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));

    const promise = apiFetch("/api/cancelled", okResponseSchema, { signal: controller.signal, timeoutMs: 0 });
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "aborted",
    } satisfies Partial<ApiError>);
    controller.abort();

    await assertion;
  });

});
