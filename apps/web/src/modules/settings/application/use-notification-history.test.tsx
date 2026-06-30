// 通知历史 hook 测试保护 infinite query 合并策略，summary/upcoming 不应随翻页被历史页覆盖。
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import { assertLocalTime } from "@/lib/time/local-time";
import type {
  NotificationHistoryResponse,
  NotificationHistoryStatusFilter,
} from "@/lib/api/schemas/notifications";
import { useNotificationHistory } from "./use-notification-history";

type HistoryMock = (
  status: NotificationHistoryStatusFilter,
  limit: number,
  offset: number,
  signal?: AbortSignal,
) => Promise<NotificationHistoryResponse>;

const mocks = vi.hoisted(() => ({
  history: vi.fn<HistoryMock>(),
}));

vi.mock("@/services/notification-service", () => ({
  notificationService: {
    history: mocks.history,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHistoryResponse(
  nextCheckDate: string,
  status: NotificationHistoryStatusFilter,
): NotificationHistoryResponse {
  const jobStatus = status === "skipped" ? "skipped" : "sent";
  const job: NotificationHistoryResponse["history"]["jobs"][number] = {
    id: `job-${status}`,
    scheduledLocalDate: assertDateOnly("2026-05-15"),
    scheduledLocalTime: assertLocalTime("08:00"),
    timeZone: "Asia/Shanghai",
    scheduledInstantUtc: "2026-05-15T00:00:00Z",
    status: jobStatus,
    attempts: 1,
    lastError: null,
    result: {},
    createdAt: "2026-05-15T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
  };

  return {
    summary: {
      nextCheck: {
        scheduledLocalDate: assertDateOnly(nextCheckDate),
        scheduledLocalTime: assertLocalTime("08:00"),
        timeZone: "Asia/Shanghai",
        scheduledInstantUtc: `${nextCheckDate}T00:00:00Z`,
      },
      nextContentBatch: null,
      blockers: [],
      enabledChannels: ["email"],
      upcomingDays: 30,
      latestJob: job,
      latestFailedJob: null,
    },
    upcoming: [],
    history: {
      jobs: [job],
      status,
      limit: 20,
      offset: 0,
      hasMore: false,
    },
  };
}

describe("useNotificationHistory", () => {
  beforeEach(() => {
    mocks.history.mockReset();
  });

  it("keeps the schedule overview stable while a history status switch is loading", async () => {
    const skippedResponse = createDeferred<NotificationHistoryResponse>();
    mocks.history.mockImplementation((status) => {
      if (status === "all") return Promise.resolve(createHistoryResponse("2026-05-16", "all"));
      return skippedResponse.promise;
    });

    const { result } = renderHook(() => useNotificationHistory(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data?.summary.nextCheck.scheduledLocalDate).toBe("2026-05-16");
    });

    act(() => {
      result.current.setStatus("skipped");
    });

    await waitFor(() => {
      expect(result.current.historyStatus).toBe("skipped");
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data?.summary.nextCheck.scheduledLocalDate).toBe("2026-05-16");
    expect(result.current.data?.history.status).toBe("skipped");
    expect(result.current.data?.history.jobs).toEqual([]);

    skippedResponse.resolve(createHistoryResponse("2026-05-17", "skipped"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.summary.nextCheck.scheduledLocalDate).toBe("2026-05-17");
    expect(result.current.data?.history.jobs).toHaveLength(1);
  });
});
